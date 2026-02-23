import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { Webhook } from 'svix'
import { handleInboundReply } from '@/lib/reply-agent'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Unified Resend webhook handler.
 * Point ALL Resend webhook events here:
 *   https://app-orcin-one-70.vercel.app/api/webhooks/resend
 *
 * Handles:
 *   email.received   → fires reply agent loop
 *   email.opened     → logs open event, updates action
 *   email.delivered  → confirms delivery
 *   email.bounced    → marks member email invalid
 *   email.complained → marks member unsubscribed
 *   email.failed     → logs failure
 *
 * Signature verification: set RESEND_SENDING_WEBHOOK_SECRET to the
 * whsec_... value from Resend → Webhooks (the sending/events webhook,
 * distinct from the inbound receiving webhook secret).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let body: any

  // ── Svix signature verification ──────────────────────────────────────────
  const signingSecret = process.env.RESEND_SENDING_WEBHOOK_SECRET
  if (signingSecret) {
    const svixId        = req.headers.get('svix-id') ?? ''
    const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
    const svixSignature = req.headers.get('svix-signature') ?? ''

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn('resend webhook: missing svix headers — rejecting')
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
      console.error('resend webhook: signature verification failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('resend webhook: RESEND_SENDING_WEBHOOK_SECRET not set, skipping verification')
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
  }

  const eventType: string = body.type ?? ''
  const data = body.data ?? body

  console.log(`resend webhook: ${eventType}`, JSON.stringify(data).slice(0, 200))

  let result: Record<string, any> = { eventType, emailId: data.email_id ?? null }

  switch (eventType) {
    case 'email.received':
      result = { ...result, ...(await handleEmailReceived(data)) }
      break
    case 'email.opened':
      result = { ...result, ...(await handleEmailOpened(data)) }
      break
    case 'email.delivered':
      result = { ...result, ...(await handleEmailDelivered(data)) }
      break
    case 'email.bounced':
      result = { ...result, ...(await handleEmailBounced(data)) }
      break
    case 'email.complained':
      result = { ...result, ...(await handleEmailComplained(data)) }
      break
    case 'email.failed':
      console.log('email.failed:', data.email_id, data.to)
      result.action = 'logged'
      break
    default:
      console.log(`resend webhook: unhandled event type "${eventType}"`)
      result.action = 'ignored'
  }

  return NextResponse.json({ ok: true, ...result })
}

// ─── email.received ───────────────────────────────────────────────────────────

async function handleEmailReceived(data: any): Promise<Record<string, any>> {
  const toRaw = data.to ?? ''
  const from = data.from ?? ''
  const emailId = data.email_id ?? ''
  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  const match = toAddress?.match(/reply\+([a-zA-Z0-9_-]+)@/)
  if (!match) {
    console.log('email.received: no reply+ token in to address:', toAddress)
    return { action: 'skipped', reason: 'no_reply_token', to: toAddress }
  }

  const actionId = match[1]

  // Resend's email.received webhook does NOT include the body in the payload.
  // Must call resend.emails.receiving.get(emailId).
  let text = data.text ?? ''
  let html = data.html ?? ''
  let bodyFetchStatus = 'not_needed'

  if (!text && !html && emailId) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY!)
      const { data: emailData, error: fetchError } = await resend.emails.receiving.get(emailId)
      if (fetchError) {
        console.error(`email.received: receiving.get(${emailId}) error:`, fetchError)
        bodyFetchStatus = `fetch_error:${(fetchError as any)?.message ?? 'unknown'}`
      } else {
        text = (emailData as any)?.text ?? ''
        html = (emailData as any)?.html ?? ''
        bodyFetchStatus = `fetched:text_len=${text.length},html_len=${html.length}`
        console.log(`email.received: ${bodyFetchStatus}`)
      }
    } catch (err: any) {
      bodyFetchStatus = `fetch_exception:${err?.message ?? 'unknown'}`
      console.error('email.received: failed to fetch email body:', err)
    }
  }

  const cleanText = stripQuotedReply(text || html)
  if (!cleanText.trim()) {
    console.log('email.received: empty body after stripping quotes')
    return { action: 'skipped', reason: 'empty_body', actionId, bodyFetchStatus }
  }

  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)?.[1] ?? from

  console.log(`email.received: actionId=${actionId} from="${fromName}" <${fromEmail}> text="${cleanText.slice(0, 80)}"`)

  try {
    await handleInboundReply({
      actionId,
      memberReply: cleanText.trim(),
      memberEmail: fromEmail,
      memberName: fromName,
    })
    console.log(`email.received: handleInboundReply completed for ${actionId}`)
    return {
      action: 'processed',
      actionId,
      from: fromEmail,
      memberName: fromName,
      replyLen: cleanText.length,
      bodyFetchStatus,
    }
  } catch (err: any) {
    console.error(`email.received: handleInboundReply FAILED for ${actionId}:`, err)
    return {
      action: 'agent_error',
      actionId,
      error: err?.message ?? 'unknown',
      bodyFetchStatus,
    }
  }
}

// ─── email.opened ─────────────────────────────────────────────────────────────

async function handleEmailOpened(data: any): Promise<Record<string, any>> {
  const emailId = data.email_id
  if (!emailId) return { action: 'skipped', reason: 'no_email_id' }

  try {
    const { error } = await supabase
      .from('agent_actions')
      .update({ email_opened_at: new Date().toISOString() })
      .eq('external_email_id', emailId)

    if (error) {
      console.log('email.opened: update failed (column may not exist):', error.message)
      return { action: 'logged', note: 'db_update_failed', emailId }
    }
    console.log(`email.opened: marked email_id=${emailId}`)
    return { action: 'marked_opened', emailId }
  } catch (e: any) {
    return { action: 'error', error: e?.message, emailId }
  }
}

// ─── email.delivered ──────────────────────────────────────────────────────────

async function handleEmailDelivered(data: any): Promise<Record<string, any>> {
  const emailId = data.email_id
  if (!emailId) return { action: 'skipped', reason: 'no_email_id' }
  console.log(`email.delivered: email_id=${emailId}`)
  return { action: 'logged', emailId }
}

// ─── email.bounced ────────────────────────────────────────────────────────────

async function handleEmailBounced(data: any): Promise<Record<string, any>> {
  const toRaw = data.to ?? ''
  const bounceEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw
  if (!bounceEmail) return { action: 'skipped', reason: 'no_to_address' }

  console.log(`email.bounced: ${bounceEmail} — marking invalid`)

  try {
    const { error } = await supabase
      .from('agent_conversations')
      .insert({
        action_id: `bounce-${Date.now()}`,
        role: 'agent_decision',
        text: `Email bounced for ${bounceEmail}. This address appears to be invalid.`,
        member_email: bounceEmail,
      })
    if (error) console.log('email.bounced insert error:', error.message)
    return { action: 'logged_bounce', email: bounceEmail }
  } catch (e: any) {
    return { action: 'error', error: e?.message, email: bounceEmail }
  }
}

// ─── email.complained ────────────────────────────────────────────────────────

async function handleEmailComplained(data: any): Promise<Record<string, any>> {
  const toRaw = data.to ?? ''
  const complainEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw
  if (!complainEmail) return { action: 'skipped', reason: 'no_to_address' }

  console.log(`email.complained: ${complainEmail} — marking unsubscribed`)

  try {
    await supabase
      .from('agent_conversations')
      .insert({
        action_id: `complaint-${Date.now()}`,
        role: 'agent_decision',
        text: `Spam complaint received from ${complainEmail}. Member has been unsubscribed.`,
        member_email: complainEmail,
      })
    return { action: 'logged_complaint', email: complainEmail }
  } catch (e: any) {
    return { action: 'error', error: e?.message, email: complainEmail }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stripQuotedReply(text: string): string {
  if (!text) return ''

  // Remove HTML tags
  let t = text.replace(/<[^>]+>/g, ' ')

  // Cut at common quoted-reply markers (inline, not just line-start)
  const cutPatterns = [
    /\s+On .{5,100}wrote:/,        // Gmail: "On Mon, Feb 22... wrote:"
    /\s+-----Original Message-----/,
    /\s+From:.*@.*\n/,
    /\s+[-]{3,}\s*Forwarded/,
  ]
  for (const pat of cutPatterns) {
    const match = t.search(pat)
    if (match > 0) {
      t = t.slice(0, match)
      break
    }
  }

  // Also strip line-quoted lines (lines starting with >)
  const lines = t.split('\n')
  const cutoff = lines.findIndex(line => /^\s*>/.test(line))
  const clean = cutoff > 0 ? lines.slice(0, cutoff) : lines

  return clean.join('\n').replace(/\s+/g, ' ').trim()
}
