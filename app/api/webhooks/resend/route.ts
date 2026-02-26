export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { Webhook } from 'svix'
import { handleInboundReply, stripQuotedReply } from '@/lib/handle-reply'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Unified Resend webhook handler.
 * Point ALL Resend webhook events here:
 *   https://app-orcin-one-70.vercel.app/api/webhooks/resend
 *
 * Handles:
 *   email.received   → routes to RetentionAgent via handle-reply
 *   email.opened     → updates outbound_messages
 *   email.delivered   → updates outbound_messages
 *   email.bounced    → logs bounce, optionally marks opt-out
 *   email.complained → logs complaint, marks opt-out
 *   email.failed     → logs failure
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

  const replyToken = match[1]

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
    return { action: 'skipped', reason: 'empty_body', replyToken, bodyFetchStatus }
  }

  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)?.[1] ?? from

  console.log(`email.received: replyToken=${replyToken} from="${fromName}" <${fromEmail}> text="${cleanText.slice(0, 80)}"`)

  try {
    const result = await handleInboundReply({
      replyToken,
      memberReply: cleanText.trim(),
      memberEmail: fromEmail,
      memberName: fromName,
    })
    console.log(`email.received: handleInboundReply completed`, result)
    return {
      action: result.processed ? 'processed' : 'skipped',
      replyToken,
      taskId: result.taskId,
      reason: result.reason,
      from: fromEmail,
      memberName: fromName,
      replyLen: cleanText.length,
      bodyFetchStatus,
    }
  } catch (err: any) {
    console.error(`email.received: handleInboundReply FAILED for ${replyToken}:`, err)
    return {
      action: 'agent_error',
      replyToken,
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
    // Update outbound_messages instead of agent_actions
    const { error } = await supabaseAdmin
      .from('outbound_messages')
      .update({ status: 'delivered' })
      .eq('provider_message_id', emailId)
      .eq('status', 'sent')

    if (error) {
      console.log('email.opened: outbound_messages update failed:', error.message)
    }
    console.log(`email.opened: email_id=${emailId}`)
    return { action: 'logged', emailId }
  } catch (e: any) {
    return { action: 'error', error: e?.message, emailId }
  }
}

// ─── email.delivered ──────────────────────────────────────────────────────────

async function handleEmailDelivered(data: any): Promise<Record<string, any>> {
  const emailId = data.email_id
  if (!emailId) return { action: 'skipped', reason: 'no_email_id' }

  try {
    await supabaseAdmin
      .from('outbound_messages')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('provider_message_id', emailId)

    console.log(`email.delivered: email_id=${emailId}`)
    return { action: 'logged', emailId }
  } catch (e: any) {
    return { action: 'error', error: e?.message, emailId }
  }
}

// ─── email.bounced ────────────────────────────────────────────────────────────

async function handleEmailBounced(data: any): Promise<Record<string, any>> {
  const toRaw = data.to ?? ''
  const bounceEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw
  if (!bounceEmail) return { action: 'skipped', reason: 'no_to_address' }

  console.log(`email.bounced: ${bounceEmail} — marking invalid`)

  try {
    // Update outbound_messages
    const emailId = data.email_id
    if (emailId) {
      await supabaseAdmin
        .from('outbound_messages')
        .update({ status: 'bounced', failed_reason: 'bounced' })
        .eq('provider_message_id', emailId)
    }

    // Add to opt-outs
    await supabaseAdmin
      .from('communication_optouts')
      .upsert({
        gym_id: '00000000-0000-0000-0000-000000000000',
        channel: 'email',
        contact: bounceEmail,
        reason: 'bounced',
      }, { onConflict: 'gym_id,channel,contact' })

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
    await supabaseAdmin
      .from('communication_optouts')
      .upsert({
        gym_id: '00000000-0000-0000-0000-000000000000',
        channel: 'email',
        contact: complainEmail,
        reason: 'spam_complaint',
      }, { onConflict: 'gym_id,channel,contact' })

    return { action: 'logged_complaint', email: complainEmail }
  } catch (e: any) {
    return { action: 'error', error: e?.message, email: complainEmail }
  }
}
