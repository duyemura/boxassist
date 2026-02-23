import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Webhook } from 'svix'
import { Resend } from 'resend'
import { handleInboundReply } from '@/lib/reply-agent'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/webhooks/inbound
 * Dedicated endpoint for Resend inbound email receiving.
 * Configure this URL in Resend → Emails → Receiving → Webhook
 * (separate from the sending webhook)
 *
 * Resend inbound payload structure:
 * {
 *   "type": "email.received",
 *   "data": {
 *     "from": "Dan <dan@pushpress.com>",
 *     "to": ["reply+token@lunovoria.resend.app"],
 *     "subject": "Re: ...",
 *     "text": "actual reply body here",   ← full body
 *     "html": "<html>...</html>",
 *     "email_id": "...",
 *     ...
 *   }
 * }
 *
 * Signature verification: Resend signs webhooks via Svix.
 * Set RESEND_WEBHOOK_SECRET to the whsec_... signing secret from
 * Resend → Emails → Receiving → Webhook settings.
 * If the env var is not set, verification is skipped (dev/test mode).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let body: any

  // ── Signature verification (Svix) ────────────────────────────────────────
  const signingSecret = process.env.RESEND_WEBHOOK_SECRET
  if (signingSecret) {
    const svixId        = req.headers.get('svix-id') ?? ''
    const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
    const svixSignature = req.headers.get('svix-signature') ?? ''

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn('inbound webhook: missing svix headers — rejecting')
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
    }

    try {
      const wh = new Webhook(signingSecret)
      body = wh.verify(rawBody, {
        'svix-id':        svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      })
    } catch (err) {
      console.error('inbound webhook: signature verification failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    // No secret configured — skip verification (dev / test)
    console.warn('inbound webhook: RESEND_WEBHOOK_SECRET not set, skipping verification')
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
  }

  // Log the full raw payload to DB for debugging
  const rawJson = JSON.stringify(body)
  console.log('inbound webhook received:', rawJson.slice(0, 500))

  // Only handle email.received — ignore other event types that might hit this URL
  const eventType = body?.type ?? ''
  if (eventType && eventType !== 'email.received') {
    console.log(`inbound webhook: ignoring event type "${eventType}"`)
    return NextResponse.json({ ok: true })
  }

  const data = body?.data ?? body  // some setups wrap in data, some don't
  const toRaw = data.to ?? data.To ?? ''
  const from = data.from ?? data.From ?? ''
  const emailId = data.email_id ?? data.emailId ?? ''
  const subject = data.subject ?? ''

  // NOTE: Resend's email.received webhook does NOT include the body in the payload.
  // Must call resend.emails.receiving.get(emailId) — the receiving-specific endpoint.
  // DO NOT use resend.emails.get() — that's for outbound emails and returns 404.
  let text = data.text ?? data.Text ?? data.plain ?? ''
  let html = data.html ?? data.Html ?? ''

  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  // Extract replyToken from reply+{token}@lunovoria.resend.app
  const match = toAddress?.match?.(/reply\+([a-zA-Z0-9_-]+)@/)
  if (!match) {
    console.log('inbound: no reply+ token found in to:', toAddress)
    await supabase.from('agent_conversations').insert({
      action_id: 'debug-inbound',
      gym_id: 'debug',
      role: 'inbound',
      text: `[no-token] from=${from} to=${toAddress} subject=${subject} email_id=${emailId}`,
      member_email: 'debug@debug.com',
      member_name: 'Debug',
    })
    return NextResponse.json({ ok: true })
  }

  const actionId = match[1]

  // Fetch body if not in payload (which is always the case for email.received)
  if (!text && !html && emailId) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY!)
      const { data: emailData, error: fetchError } = await resend.emails.receiving.get(emailId)
      if (fetchError) {
        console.error(`inbound: receiving.get(${emailId}) error:`, fetchError)
      } else {
        text = (emailData as any)?.text ?? ''
        html = (emailData as any)?.html ?? ''
        console.log(`inbound: fetched body via receiving.get(${emailId}), text_len=${text.length}`)
      }
    } catch (err) {
      console.error('inbound: failed to fetch email body:', err)
    }
  }

  const bodyText = text || stripHtml(html)

  if (!bodyText.trim()) {
    console.log(`inbound: empty body for token ${actionId}, email_id=${emailId}`)
    await supabase.from('agent_conversations').insert({
      action_id: actionId,
      gym_id: 'demo',
      role: 'inbound',
      text: `[empty-body] email_id=${emailId} raw_keys=${Object.keys(data).join(',')}`,
      member_email: from,
      member_name: 'Unknown',
    })
    return NextResponse.json({ ok: true })
  }

  const cleanText = stripQuotedReply(bodyText)
  if (!cleanText.trim()) {
    console.log(`inbound: empty after quote-strip for token ${actionId}`)
    return NextResponse.json({ ok: true })
  }

  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)?.[1] ?? from

  console.log(`inbound: token=${actionId} from=${fromEmail} text="${cleanText.slice(0, 80)}"`)

  try {
    await handleInboundReply({
      actionId,
      memberReply: cleanText.trim(),
      memberEmail: fromEmail,
      memberName: fromName,
    })
    console.log(`inbound: handleInboundReply completed for ${actionId}`)
  } catch (err) {
    console.error(`inbound: handleInboundReply FAILED:`, err)
  }

  return NextResponse.json({ ok: true })
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripQuotedReply(text: string): string {
  if (!text) return ''
  let t = text.replace(/<[^>]+>/g, ' ')
  const cutPatterns = [
    /\s+On .{5,100}wrote:/,
    /\s+-----Original Message-----/,
    /\s+From:.*@.*\n/,
  ]
  for (const pat of cutPatterns) {
    const match = t.search(pat)
    if (match > 0) { t = t.slice(0, match); break }
  }
  const lines = t.split('\n')
  const cutoff = lines.findIndex(line => /^\s*>/.test(line))
  const clean = cutoff > 0 ? lines.slice(0, cutoff) : lines
  return clean.join('\n').replace(/\s+/g, ' ').trim()
}
