import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase'
import { sendGmailMessage } from './gmail'
import { Resend } from 'resend'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const resend = new Resend(process.env.RESEND_API_KEY!)

interface ConversationMessage {
  role: 'outbound' | 'inbound'
  text: string
  timestamp: string
}

interface ReplyDecision {
  action: 'reply' | 'close' | 'escalate' | 'reopen'
  reply?: string
  newGoal?: string      // populated when action === 'reopen'
  scoreReason: string
  outcomeScore: number  // 0-100: how well did we achieve the goal?
  resolved: boolean
}

export async function handleInboundReply({
  actionId,
  memberReply,
  memberEmail,
  memberName,
}: {
  actionId: string
  memberReply: string
  memberEmail: string
  memberName: string
}): Promise<void> {
  // Load the action + its playbook context
  // actionId here is the replyToken from the email address (e.g. demo-xxx or a real UUID)
  // Try direct UUID lookup first, then fall back to metadata->replyToken for demo actions
  let action: any = null

  // Try UUID match (production actions) — simple select, no join
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidPattern.test(actionId)) {
    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .select('*')
      .eq('id', actionId)
      .single()
    if (error) console.error('handleInboundReply: uuid lookup error', error.message)
    action = data
  }

  // Fall back: demo token lookup via content->_replyToken (jsonb)
  if (!action) {
    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .select('*')
      .eq('content->>_replyToken', actionId)
      .single()
    if (error) console.error('handleInboundReply: token lookup error', error.message)
    action = data
  }

  if (!action) {
    console.error('handleInboundReply: action not found for token', actionId)
    return
  }

  // If already resolved, don't re-process — prevents ghost replies on closed threads
  if (action.resolved_at) {
    console.log(`handleInboundReply: action ${action.id} already resolved at ${action.resolved_at}, skipping`)
    return
  }

  // actionDbId = the real UUID for agent_actions updates
  // actionId = the replyToken used for agent_conversations lookup
  const actionDbId: string = action.id

  const content = action.content as any

  // Demo actions embed context in content with _ prefix
  const isDemo = content._isDemo === true
  const gymId = content._gymId ?? 'demo'
  const gymName = content._gymName ?? 'the gym'
  const automationLevel = content._automationLevel ?? 'full_auto'
  const playbookGoal = content.recommendedAction ?? 'Re-engage the member and ensure they feel supported'
  const originalMessage = content.draftedMessage ?? ''

  console.log(`handleInboundReply: found action ${actionDbId} (token=${actionId}), automationLevel=${automationLevel}`)

  // Load conversation history — exclude agent_decision rows (internal metadata, not real messages)
  const { data: history } = await supabaseAdmin
    .from('agent_conversations')
    .select('role, text, created_at')
    .eq('action_id', actionId)
    .not('role', 'eq', 'agent_decision')  // never feed decision rows back to Claude
    .order('created_at', { ascending: true })
    .limit(50)

  const conversation: ConversationMessage[] = [
    { role: 'outbound', text: originalMessage, timestamp: action.created_at },
    ...(history ?? [])
      .filter((h: any) => h.text !== originalMessage) // dedupe — outbound already added above
      .map((h: any) => ({ role: h.role, text: h.text, timestamp: h.created_at })),
    { role: 'inbound', text: memberReply, timestamp: new Date().toISOString() },
  ]

  // Store inbound reply
  await supabaseAdmin.from('agent_conversations').insert({
    action_id: actionId,
    gym_id: gymId,
    role: 'inbound',
    text: memberReply,
    member_email: memberEmail,
    member_name: memberName,
  })

  // Ask Claude to evaluate and decide
  console.log(`handleInboundReply: calling evaluateReply for ${actionDbId}`)
  const decision = await evaluateReply({ conversation, playbookGoal, memberName, gymName, automationLevel })
  console.log(`handleInboundReply: decision=${JSON.stringify(decision)}`)

  // Store the decision in conversations (keyed by replyToken)
  await supabaseAdmin.from('agent_conversations').insert({
    action_id: actionId,
    gym_id: gymId,
    role: 'agent_decision',
    text: JSON.stringify(decision),
    member_email: memberEmail,
    member_name: memberName,
  })

  if (decision.action === 'close' || decision.resolved) {
    // If there's a closing reply (e.g. "Can't wait to see you Thursday!"), send it first
    if (decision.reply && automationLevel !== 'draft_only') {
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content })
    }
    // Then close the action
    await supabaseAdmin
      .from('agent_actions')
      .update({
        approved: true,
        outcome_score: decision.outcomeScore,
        outcome_reason: decision.scoreReason,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', actionDbId)
    console.log(`handleInboundReply: closed action ${actionDbId} score=${decision.outcomeScore}`)
    return
  }

  if (decision.action === 'escalate') {
    await supabaseAdmin
      .from('agent_actions')
      .update({ needs_review: true, review_reason: decision.scoreReason })
      .eq('id', actionDbId)
    console.log(`handleInboundReply: escalated action ${actionDbId}`)
    return
  }

  if (decision.action === 'reopen') {
    // Acknowledge the new context, then create a new action for tracking
    if (decision.reply) {
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content })
    }

    // Create a new agent_action to track the new task
    const newGoal = decision.newGoal ?? `Follow up on new context from ${memberName}: ${memberReply.slice(0, 80)}`
    const { data: newAction } = await supabaseAdmin
      .from('agent_actions')
      .insert({
        action_type: 'email',
        content: {
          ...content,
          recommendedAction: newGoal,
          draftedMessage: decision.reply ?? '',
          _isDemo: content._isDemo,
          _replyToken: `${actionId}-r${Date.now()}`,
          _gymId: gymId,
          _automationLevel: content._automationLevel ?? 'full_auto',
          _playbookName: content._playbookName ?? 'Re-engagement',
          _reopenedFrom: actionDbId,
        },
        needs_review: true,
        review_reason: `Reopened: ${newGoal}`,
      })
      .select('id')
      .single()

    // Seed the new thread with conversation history so far
    if (newAction) {
      await supabaseAdmin.from('agent_conversations').insert({
        action_id: `${actionId}-r${Date.now()}`,
        gym_id: gymId,
        role: 'inbound',
        text: `[Reopened] ${memberReply}`,
        member_email: memberEmail,
        member_name: memberName,
      })
    }

    console.log(`handleInboundReply: reopened as new action for ${memberName}`)
    return
  }

  if (decision.action === 'reply' && decision.reply) {
    if (automationLevel === 'full_auto') {
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content })
    } else if (automationLevel === 'smart') {
      if (decision.outcomeScore >= 60) {
        await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content })
      } else {
        await queueReplyForApproval({ actionDbId, reply: decision.reply, reason: decision.scoreReason })
      }
    } else {
      await queueReplyForApproval({ actionDbId, reply: decision.reply, reason: decision.scoreReason })
    }
  }
}

async function evaluateReply({
  conversation,
  playbookGoal,
  memberName,
  gymName,
  automationLevel,
}: {
  conversation: ConversationMessage[]
  playbookGoal: string
  memberName: string
  gymName: string
  automationLevel: string
}): Promise<ReplyDecision> {
  const convoText = conversation
    .map(m => `[${m.role.toUpperCase()}]: ${m.text}`)
    .join('\n\n')

  const system = `You are a retention agent for ${gymName}, writing on behalf of the gym owner/coach.

Your job: read the conversation and decide what to do next to achieve the goal.

Original goal: "${playbookGoal}"

## Vague replies are NOT a close — this is critical

Phrases like "I'll check the schedule", "maybe soon", "I'll try to come in", "things have been busy", "I'll see what works" are SOFT DEFLECTIONS. They feel polite but commit to nothing. The goal is NOT achieved until the member has:
- Confirmed a specific day or class they plan to attend, OR
- Explicitly said they're cancelling or not interested

If you receive a vague reply, your job is to gently move toward a concrete next step WITHOUT being pushy. Make it smaller and easier to say yes to.

## Decision rules

REPLY (keep the conversation going) when:
- Member gave a vague, non-committal answer ("I'll check", "maybe soon", "been busy")
- Member showed ANY positive signal but hasn't committed to a specific action
- A concrete next step hasn't been agreed on yet
- You can make the ask smaller or remove a barrier

Reply strategy for vague answers:
- Acknowledge what they said briefly
- Ask ONE specific, low-friction question: "Is there a day that usually works better for you?" or "Would mornings or evenings be easier right now?"
- Offer to handle the logistics: "I can hold a spot for you if you know roughly when"
- Do NOT pepper them with multiple questions

CLOSE when:
- Member confirmed a specific day, class, or time they're coming in
- Member said clearly they're not interested / cancelling / moved
- Goal is genuinely achieved with a concrete commitment

ESCALATE when:
- Member is upset, frustrated, or has a complaint
- Situation requires a human decision (billing dispute, injury, etc.)

## Reply style
- SHORT: 2-3 sentences max
- Warm, first name only, coach voice
- One question or one offer — never both at once
- No exclamation points unless the vibe is genuinely celebratory

Respond with ONLY valid JSON (no markdown):
{ "action": "reply"|"close"|"escalate"|"reopen", "reply": "string", "newGoal": "string (only for reopen)", "scoreReason": "one sentence", "outcomeScore": 0-100, "resolved": true|false }`

  const prompt = `Conversation with ${memberName}:\n\n${convoText}\n\nWhat should the agent do next?`

  try {
    console.log('evaluateReply: calling Claude...')
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    console.log('evaluateReply: Claude responded')

    const text = (response.content[0] as any).text?.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned)
  } catch (err) {
    console.error('evaluateReply error:', err)
    // Safe default — escalate rather than auto-send bad content
    return { action: 'escalate', scoreReason: 'AI evaluation failed', outcomeScore: 0, resolved: false }
  }
}

async function sendReply({
  actionId, actionDbId, gymId, memberEmail, memberName, reply, content,
}: {
  actionId: string      // replyToken — for email address + conversations table
  actionDbId: string    // DB UUID — for agent_actions updates
  gymId?: string
  memberEmail: string
  memberName: string
  reply: string
  content: any
}) {
  const subject = `Re: ${content.messageSubject ?? 'Checking in'}`
  let sent = false

  // Try Gmail first
  if (gymId) {
    const result = await sendGmailMessage({ gymId, to: memberEmail, subject, body: reply })
    if (result) sent = true
  }

  // Fall back to Resend
  if (!sent) {
    const replyTo = `reply+${actionId}@lunovoria.resend.app`
    const gymName = content._gymName ?? 'GymAgents'
    const coachName = content._coachName ?? null

    // Convert reply text to HTML paragraphs — skip blank lines to avoid ghost spacing
    const htmlBody = reply
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#111827;">${line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`)
      .join('\n')

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'GymAgents <noreply@lunovoria.resend.app>',
      replyTo,
      to: memberEmail,
      subject,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;max-width:520px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:20px 28px 16px;border-bottom:2px solid #0063FF;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:24px;height:24px;background:#0063FF;border-radius:2px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-weight:700;font-size:12px;">G</span>
                  </td>
                  <td style="padding-left:8px;">
                    <span style="font-size:12px;font-weight:600;color:#374151;">GymAgents</span>
                    <span style="font-size:12px;color:#9ca3af;"> &middot; ${gymName}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 24px;">
              ${htmlBody}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
              <p style="font-size:11px;color:#9ca3af;line-height:1.6;margin:0 0 8px;">
                Reply to this email and the agent will continue the conversation automatically.
              </p>
              <p style="font-size:11px;color:#9ca3af;margin:0;">
                <a href="https://app-orcin-one-70.vercel.app/login" style="color:#0063FF;text-decoration:none;font-weight:600;">Connect your gym &rarr;</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    })
  }

  // Store outbound in conversation
  await supabaseAdmin.from('agent_conversations').insert({
    action_id: actionId,
    gym_id: gymId,
    role: 'outbound',
    text: reply,
    member_email: memberEmail,
    member_name: memberName,
  })
}

async function queueReplyForApproval({ actionDbId, reply, reason }: { actionDbId: string; reply: string; reason: string }) {
  await supabaseAdmin
    .from('agent_actions')
    .update({
      pending_reply: reply,
      pending_reply_reason: reason,
      needs_review: true,
    })
    .eq('id', actionDbId)
}
