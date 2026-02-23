import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { handleInboundReply } from '@/lib/reply-agent'
import { RetentionAgent } from '@/lib/agents/RetentionAgent'
import * as dbTasks from '@/lib/db/tasks'
import * as dbEvents from '@/lib/db/events'
import * as dbCommands from '@/lib/db/commands'
import Anthropic from '@anthropic-ai/sdk'

const resend = new Resend(process.env.RESEND_API_KEY!)
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

  // ── Phase 2: Also run RetentionAgent (dual-running until Phase 3) ──────────
  // We need the shadow task ID to route the reply to the agent.
  // actionId here is the replyToken — look up the shadow task by legacy_action_id or reply_token.
  try {
    // Look up the shadow task that was created during Phase 1 dual-write
    const { data: taskRow } = await (async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      return sb
        .from('agent_tasks')
        .select('id, gym_id')
        .or(`legacy_action_id.eq.${actionId}`)
        .eq('assigned_agent', 'retention')
        .single()
    })()

    if (taskRow?.id) {
      const retentionAgent = new RetentionAgent({
        db: {
          getTask: dbTasks.getTask,
          updateTaskStatus: dbTasks.updateTaskStatus,
          appendConversation: dbTasks.appendConversation,
          getConversationHistory: dbTasks.getConversationHistory,
          createOutboundMessage: dbCommands.createOutboundMessage,
          updateOutboundMessageStatus: dbCommands.updateOutboundMessageStatus,
        },
        events: {
          publishEvent: dbEvents.publishEvent,
        },
        mailer: {
          sendEmail: async (params) => {
            const result = await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL ?? 'GymAgents <noreply@lunovoria.resend.app>',
              to: params.to,
              subject: params.subject,
              html: params.html,
              ...(params.replyTo ? { replyTo: params.replyTo } : {}),
            })
            return { id: result.data?.id ?? 'unknown' }
          },
        },
        claude: {
          evaluate: async (system, prompt) => {
            const response = await anthropicClient.messages.create({
              model: 'claude-sonnet-4-5',
              max_tokens: 600,
              system,
              messages: [{ role: 'user', content: prompt }],
            })
            return (response.content[0] as any).text?.trim() ?? ''
          },
        },
      })

      await retentionAgent.handleReply({
        taskId: taskRow.id,
        memberEmail: fromEmail,
        replyContent: cleanText.trim(),
        gymId: taskRow.gym_id,
      })
      console.log(`inbound-email: RetentionAgent.handleReply completed for task ${taskRow.id}`)
    }
  } catch (retentionErr: any) {
    // Log but don't fail the webhook — handleInboundReply already ran
    console.error(`inbound-email: RetentionAgent FAILED (non-fatal):`, retentionErr?.message)
  }
  // ── End Phase 2 ────────────────────────────────────────────────────────────

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
