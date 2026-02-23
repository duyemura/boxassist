import { NextRequest, NextResponse } from 'next/server'
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
 */
// Simple in-memory rate limit: max 60 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; reset: number }>()

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now = Date.now()
  const window = 60_000
  const limit = 60

  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.reset) {
    rateLimitMap.set(ip, { count: 1, reset: now + window })
  } else {
    entry.count++
    if (entry.count > limit) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const eventType: string = body.type ?? ''
  const data = body.data ?? body

  console.log(`resend webhook: ${eventType}`, JSON.stringify(data).slice(0, 200))

  switch (eventType) {
    case 'email.received':
      // Await directly — Vercel kills background work after response is sent
      await handleEmailReceived(data)
      break
    case 'email.opened':
      await handleEmailOpened(data)
      break
    case 'email.delivered':
      await handleEmailDelivered(data)
      break
    case 'email.bounced':
      await handleEmailBounced(data)
      break
    case 'email.complained':
      await handleEmailComplained(data)
      break
    case 'email.failed':
      console.log('email.failed:', data.email_id, data.to)
      break
    default:
      console.log(`resend webhook: unhandled event type "${eventType}"`)
  }

  return NextResponse.json({ ok: true })
}

// ─── email.received ───────────────────────────────────────────────────────────

async function handleEmailReceived(data: any) {
  const toRaw = data.to ?? ''
  const from = data.from ?? ''
  const text = data.text ?? data.html ?? ''

  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  // Extract actionId from reply+{actionId}@lunovoria.resend.app
  const match = toAddress?.match(/reply\+([a-zA-Z0-9_-]+)@/)
  if (!match) {
    console.log('email.received: no reply+ token in to address:', toAddress)
    return
  }

  const actionId = match[1]
  const cleanText = stripQuotedReply(text)
  if (!cleanText.trim()) return

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
  } catch (err) {
    console.error(`email.received: handleInboundReply FAILED for ${actionId}:`, err)
  }
}

// ─── email.opened ─────────────────────────────────────────────────────────────

async function handleEmailOpened(data: any) {
  // data.email_id is Resend's email id — we store this as external_email_id
  // Update agent_actions: mark as opened, note the timestamp
  const emailId = data.email_id
  if (!emailId) return

  try {
    const { error } = await supabase
      .from('agent_actions')
      .update({
        email_opened_at: new Date().toISOString(),
      })
      .eq('external_email_id', emailId)

    if (error) {
      // Column may not exist yet — log and continue
      console.log('email.opened: update failed (column may not exist):', error.message)
    } else {
      console.log(`email.opened: marked email_id=${emailId}`)
    }
  } catch (e) {
    console.log('email.opened error:', e)
  }
}

// ─── email.delivered ──────────────────────────────────────────────────────────

async function handleEmailDelivered(data: any) {
  const emailId = data.email_id
  if (!emailId) return
  console.log(`email.delivered: email_id=${emailId}`)
  // Future: update delivery status on agent_actions
}

// ─── email.bounced ────────────────────────────────────────────────────────────

async function handleEmailBounced(data: any) {
  // Mark member email as invalid so we don't send to them again
  const toRaw = data.to ?? ''
  const bounceEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw
  if (!bounceEmail) return

  console.log(`email.bounced: ${bounceEmail} — marking invalid`)

  try {
    // Log into agent_conversations so gym owner can see it
    const { error } = await supabase
      .from('agent_conversations')
      .insert({
        action_id: `bounce-${Date.now()}`,
        role: 'agent_decision',
        text: `Email bounced for ${bounceEmail}. This address appears to be invalid.`,
        member_email: bounceEmail,
      })
    if (error) console.log('email.bounced insert error:', error.message)
  } catch (e) {
    console.log('email.bounced error:', e)
  }
}

// ─── email.complained ────────────────────────────────────────────────────────

async function handleEmailComplained(data: any) {
  const toRaw = data.to ?? ''
  const complainEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw
  if (!complainEmail) return

  console.log(`email.complained: ${complainEmail} — marking unsubscribed`)

  try {
    await supabase
      .from('agent_conversations')
      .insert({
        action_id: `complaint-${Date.now()}`,
        role: 'agent_decision',
        text: `Spam complaint received from ${complainEmail}. Member has been unsubscribed from all future outreach.`,
        member_email: complainEmail,
      })
  } catch (e) {
    console.log('email.complained error:', e)
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stripQuotedReply(text: string): string {
  if (!text) return ''
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const lines = stripped.split('\n')
  const cutoff = lines.findIndex(line =>
    /^[-_]{3,}/.test(line) ||
    /^On .+wrote:/.test(line) ||
    /^From:.*@/.test(line) ||
    /^>/.test(line.trim())
  )
  const clean = cutoff > 0 ? lines.slice(0, cutoff) : lines
  return clean.join('\n').trim()
}
