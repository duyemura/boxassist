import { NextRequest, NextResponse } from 'next/server'
import { handleInboundReply } from '@/lib/reply-agent'

/**
 * Inbound email webhook — handles Resend inbound format.
 * Resend sends: { type: "email.received", data: { from, to, subject, text, html, ... } }
 * Reply-To address format: reply+{actionId}@lunovoria.resend.app
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  console.log('inbound-email webhook received:', JSON.stringify(body).slice(0, 300))

  // Resend inbound format: { type: "email.received", data: { ... } }
  // Also support flat format for Postmark compatibility
  let emailData: any = body
  if (body.type === 'email.received' && body.data) {
    emailData = body.data
  }

  // Parse fields — Resend inbound uses: from, to (array), subject, text, html
  const toRaw = emailData.to ?? emailData.To ?? ''
  const from = emailData.from ?? emailData.From ?? ''
  const text = emailData.text ?? emailData.TextBody ?? emailData.html ?? emailData.HtmlBody ?? ''
  const subject = emailData.subject ?? emailData.Subject ?? ''

  // to can be array or string
  const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw

  console.log(`Inbound: to=${toAddress} from=${from} subject="${subject}"`)

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

  // Strip quoted reply text — only take the new part above the quote line
  const cleanText = stripQuotedReply(text)

  if (!cleanText.trim()) {
    console.log('inbound-email: empty after stripping quoted text')
    return NextResponse.json({ ok: true })
  }

  // Extract name from "Name <email>" format
  const nameMatch = from.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0]
  const fromEmail = from.match(/<(.+?)>/)? from.match(/<(.+?)>/)![1] : from

  console.log(`inbound-email: firing reply agent for action=${actionId} member="${fromName}"`)

  // Fire the reply agent — non-blocking so webhook returns fast
  handleInboundReply({
    actionId,
    memberReply: cleanText.trim(),
    memberEmail: fromEmail,
    memberName: fromName,
  }).catch(err => console.error('handleInboundReply error:', err))

  return NextResponse.json({ ok: true })
}

function stripQuotedReply(text: string): string {
  if (!text) return ''
  // Strip HTML tags if it's an HTML body
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  // Remove common reply quote markers
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
