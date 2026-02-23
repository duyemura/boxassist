import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { handleInboundReply } from '@/lib/reply-agent'

const resend = new Resend(process.env.RESEND_API_KEY!)

/**
 * Inbound email webhook — handles Resend inbound format.
 *
 * IMPORTANT: Resend's email.received webhook payload does NOT include the email body.
 * Only metadata is sent (from, to, subject, email_id). The body must be fetched
 * separately via resend.emails.receiving.get(emailId).
 *
 * Resend sends: { type: "email.received", data: { from, to, subject, email_id, ... } }
 * Reply-To address format: reply+{actionId}@lunovoria.resend.app
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  console.log('inbound-email webhook received:', JSON.stringify(body).slice(0, 500))

  // Resend inbound format: { type: "email.received", data: { ... } }
  // Also support flat format for Postmark compatibility
  let emailData: any = body
  if (body.type === 'email.received' && body.data) {
    emailData = body.data
  }

  // Parse fields — Resend inbound uses: from, to (array), subject, email_id
  const toRaw = emailData.to ?? emailData.To ?? ''
  const from = emailData.from ?? emailData.From ?? ''
  const subject = emailData.subject ?? emailData.Subject ?? ''
  const emailId = emailData.email_id ?? emailData.emailId ?? ''

  // to can be array or string
  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  console.log(`inbound-email: to=${toAddress} from=${from} subject="${subject}" email_id=${emailId}`)

  if (!toAddress || !from) {
    console.log('inbound-email: missing to or from')
    return NextResponse.json({ ok: true })
  }

  // Extract actionId from reply+{actionId}@lunovoria.resend.app
  const match = toAddress.match(/reply\+([a-zA-Z0-9_-]+)@/)
  if (!match) {
    console.log('inbound-email: no reply+ actionId found in:', toAddress)
    return NextResponse.json({ ok: true })
  }

  const actionId = match[1]
  console.log(`inbound-email: actionId=${actionId}`)

  // Fetch body — Resend's email.received payload never includes the body text.
  // Must use resend.emails.receiving.get(emailId) — the receiving-specific endpoint.
  // DO NOT use resend.emails.get() — that's for outbound emails and returns 404.
  let text = emailData.text ?? emailData.TextBody ?? ''
  let html = emailData.html ?? emailData.HtmlBody ?? ''

  if (!text && !html && emailId) {
    console.log(`inbound-email: fetching body via receiving.get(${emailId})`)
    try {
      const { data: emailFetched, error: fetchError } = await resend.emails.receiving.get(emailId)
      if (fetchError) {
        console.error(`inbound-email: receiving.get error:`, fetchError)
      } else {
        text = (emailFetched as any)?.text ?? ''
        html = (emailFetched as any)?.html ?? ''
        console.log(`inbound-email: fetched body — text_len=${text.length} html_len=${html.length}`)
      }
    } catch (err: any) {
      console.error('inbound-email: failed to fetch email body:', err?.message)
    }
  }

  const bodyText = text || stripHtml(html)

  if (!bodyText.trim()) {
    console.log(`inbound-email: empty body for actionId=${actionId} email_id=${emailId}`)
    return NextResponse.json({ ok: true, skipped: true, reason: 'empty_body', debug: { actionId, emailId } })
  }

  // Strip quoted reply text — only take the new part above the quote line
  const cleanText = stripQuotedReply(bodyText)

  if (!cleanText.trim()) {
    console.log('inbound-email: empty after stripping quoted text')
    return NextResponse.json({ ok: true, skipped: true, reason: 'empty_after_strip' })
  }

  // Extract name from "Name <email>" format
  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)?.[1] ?? from

  console.log(`inbound-email: firing reply agent for action=${actionId} member="${fromName}" reply="${cleanText.slice(0, 80)}"`)

  // Await the reply agent so errors surface in logs
  try {
    await handleInboundReply({
      actionId,
      memberReply: cleanText.trim(),
      memberEmail: fromEmail,
      memberName: fromName,
    })
    console.log(`inbound-email: handleInboundReply completed for ${actionId}`)
  } catch (err: any) {
    console.error(`inbound-email: handleInboundReply FAILED:`, err?.message)
  }

  return NextResponse.json({ ok: true, processed: true, actionId, from: fromEmail })
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripQuotedReply(text: string): string {
  if (!text) return ''
  // Strip HTML tags if it's an HTML body
  let t = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // Remove common reply quote markers
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
  const cutoff = lines.findIndex(line =>
    /^[-_]{3,}/.test(line) ||
    /^On .+wrote:/.test(line) ||
    /^From:.*@/.test(line) ||
    /^\s*>/.test(line)
  )
  const clean = cutoff > 0 ? lines.slice(0, cutoff) : lines
  return clean.join('\n').trim()
}
