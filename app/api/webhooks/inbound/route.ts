export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { Resend } from 'resend'
import { handleInboundReply, stripQuotedReply, stripHtml } from '@/lib/handle-reply'

/**
 * POST /api/webhooks/inbound
 * Dedicated endpoint for Resend inbound email receiving.
 * Configure this URL in Resend → Emails → Receiving → Webhook
 *
 * Resend inbound payload: { type: "email.received", data: { from, to, subject, email_id, ... } }
 * Reply-To address format: reply+{taskId}@lunovoria.resend.app
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
    console.warn('inbound webhook: RESEND_WEBHOOK_SECRET not set, skipping verification')
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
  }

  console.log('inbound webhook received:', JSON.stringify(body).slice(0, 500))

  // Only handle email.received
  const eventType = body?.type ?? ''
  if (eventType && eventType !== 'email.received') {
    console.log(`inbound webhook: ignoring event type "${eventType}"`)
    return NextResponse.json({ ok: true, skipped: true, reason: `event_type_ignored:${eventType}` })
  }

  const data = body?.data ?? body
  const toRaw = data.to ?? data.To ?? ''
  const from = data.from ?? data.From ?? ''
  const emailId = data.email_id ?? data.emailId ?? ''

  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  // Extract replyToken from reply+{token}@lunovoria.resend.app
  const match = toAddress?.match?.(/reply\+([a-zA-Z0-9_-]+)@/)
  if (!match) {
    console.log('inbound: no reply+ token found in to:', toAddress)
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_reply_token' })
  }

  const replyToken = match[1]

  // Fetch body — Resend's email.received payload never includes it
  let text = data.text ?? data.Text ?? data.plain ?? ''
  let html = data.html ?? data.Html ?? ''
  let bodyFetchStatus = 'not_needed'

  if (!text && !html && emailId) {
    bodyFetchStatus = 'fetching'
    try {
      const resend = new Resend(process.env.RESEND_API_KEY!)
      const { data: emailData, error: fetchError } = await resend.emails.receiving.get(emailId)
      if (fetchError) {
        console.error(`inbound: receiving.get(${emailId}) error:`, fetchError)
        bodyFetchStatus = `fetch_error:${(fetchError as any)?.message ?? 'unknown'}`
      } else {
        text = (emailData as any)?.text ?? ''
        html = (emailData as any)?.html ?? ''
        bodyFetchStatus = `fetched:text_len=${text.length},html_len=${html.length}`
        console.log(`inbound: ${bodyFetchStatus}`)
      }
    } catch (err: any) {
      bodyFetchStatus = `fetch_exception:${err?.message ?? 'unknown'}`
      console.error('inbound: failed to fetch email body:', err)
    }
  }

  const bodyText = text || stripHtml(html)
  if (!bodyText.trim()) {
    console.log(`inbound: empty body for token ${replyToken}, email_id=${emailId}`)
    return NextResponse.json({ ok: true, skipped: true, reason: 'empty_body', debug: { replyToken, emailId, bodyFetchStatus } })
  }

  const cleanText = stripQuotedReply(bodyText)
  if (!cleanText.trim()) {
    console.log(`inbound: empty after quote-strip for token ${replyToken}`)
    return NextResponse.json({ ok: true, skipped: true, reason: 'empty_after_strip' })
  }

  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)?.[1] ?? from

  console.log(`inbound: token=${replyToken} from=${fromEmail} text="${cleanText.slice(0, 80)}"`)

  let agentResult = 'not_run'
  try {
    const result = await handleInboundReply({
      replyToken,
      memberReply: cleanText.trim(),
      memberEmail: fromEmail,
      memberName: fromName,
    })
    agentResult = result.processed ? 'completed' : `skipped:${result.reason}`
    console.log(`inbound: handleInboundReply result:`, result)
  } catch (err: any) {
    agentResult = `failed:${err?.message ?? 'unknown'}`
    console.error(`inbound: handleInboundReply FAILED:`, err)
  }

  return NextResponse.json({
    ok: agentResult.startsWith('completed'),
    processed: true,
    replyToken,
    from: fromEmail,
    memberName: fromName,
    replyLen: cleanText.length,
    bodyFetchStatus,
    agentResult,
  })
}
