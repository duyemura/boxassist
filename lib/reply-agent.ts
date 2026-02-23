import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase'
import { sendGmailMessage } from './gmail'
import { Resend } from 'resend'
import { getOrCreateTaskForAction, appendConversation, updateTaskStatus, DEMO_GYM_ID } from './db/tasks'
import { publishEvent } from './db/events'

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

  // ── Phase 1 dual-write: find/create shadow task + publish MemberReplyReceived event ──
  let shadowTaskId: string | null = null
  try {
    shadowTaskId = await getOrCreateTaskForAction(action)
    if (shadowTaskId) {
      // Append each prior outbound to task_conversations if this is the first inbound
      // (backfill script will handle bulk; here we just ensure the inbound message is captured)
      const resolvedGymId = (gymId === 'demo' || !gymId) ? DEMO_GYM_ID : gymId
      await appendConversation(shadowTaskId, {
        gymId: resolvedGymId,
        role: 'member',
        content: memberReply,
        agentName: undefined,
      })
      await publishEvent({
        gymId: resolvedGymId,
        eventType: 'MemberReplyReceived',
        aggregateId: shadowTaskId,
        aggregateType: 'task',
        payload: {
          taskId: shadowTaskId,
          legacyActionId: action.id,
          memberEmail,
          memberName,
          replyText: memberReply,
        },
        metadata: { source: 'reply-agent', actionId },
      })
    }
  } catch (dualWriteErr) {
    console.error('handleInboundReply: dual-write (inbound) error — continuing', dualWriteErr)
  }
  // ─────────────────────────────────────────────────────────────────────────────

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

  // ── Phase 1 dual-write: store decision in task_conversations ──
  if (shadowTaskId) {
    try {
      const resolvedGymId = (gymId === 'demo' || !gymId) ? DEMO_GYM_ID : gymId
      await appendConversation(shadowTaskId, {
        gymId: resolvedGymId,
        role: 'system',
        content: `Agent decision: ${decision.action} (score=${decision.outcomeScore})`,
        agentName: 'retention',
        evaluation: {
          reasoning: (decision as any).reasoning,
          action: decision.action,
          outcomeScore: decision.outcomeScore,
          resolved: decision.resolved,
          scoreReason: decision.scoreReason,
          outcome: (decision as any).outcome,
        },
      })
    } catch (dualWriteErr) {
      console.error('handleInboundReply: dual-write (decision) error — continuing', dualWriteErr)
    }
  }
  // ─────────────────────────────────────────────────────────────

  if (decision.action === 'close' || decision.resolved) {
    // If there's a closing reply (e.g. "Can't wait to see you Thursday!"), send it first
    if (decision.reply && automationLevel !== 'draft_only') {
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content, shadowTaskId })
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
    // ── Phase 1 dual-write: resolve shadow task ──
    if (shadowTaskId) {
      try {
        await updateTaskStatus(shadowTaskId, 'resolved', {
          outcome: (decision as any).outcome ?? 'engaged',
          outcomeScore: decision.outcomeScore,
          outcomeReason: decision.scoreReason,
        })
      } catch (dualWriteErr) {
        console.error('handleInboundReply: dual-write (close task) error — continuing', dualWriteErr)
      }
    }
    // ────────────────────────────────────────────
    console.log(`handleInboundReply: closed action ${actionDbId} score=${decision.outcomeScore}`)
    return
  }

  if (decision.action === 'escalate') {
    await supabaseAdmin
      .from('agent_actions')
      .update({ needs_review: true, review_reason: decision.scoreReason })
      .eq('id', actionDbId)
    // ── Phase 1 dual-write: escalate shadow task ──
    if (shadowTaskId) {
      try {
        await updateTaskStatus(shadowTaskId, 'escalated', {
          outcome: 'escalated',
          outcomeReason: decision.scoreReason,
        })
      } catch (dualWriteErr) {
        console.error('handleInboundReply: dual-write (escalate task) error — continuing', dualWriteErr)
      }
    }
    // ─────────────────────────────────────────────
    console.log(`handleInboundReply: escalated action ${actionDbId}`)
    return
  }

  if (decision.action === 'reopen') {
    // Acknowledge the new context, then create a new action for tracking
    if (decision.reply) {
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content, shadowTaskId })
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
      await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content, shadowTaskId })
    } else if (automationLevel === 'smart') {
      if (decision.outcomeScore >= 60) {
        await sendReply({ actionId, actionDbId, gymId, memberEmail, memberName, reply: decision.reply, content, shadowTaskId })
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

  const system = `You are a retention sub-agent for ${gymName}, acting as a skilled gym coach and relationship manager.

You receive a conversation between the gym and a member, plus a goal. Your job is to reason carefully about what the member actually needs, then decide and draft the best next action.

## Your goal for this conversation
${playbookGoal}

## How to reason (think step by step before deciding)

First, understand what the member is actually communicating:
- What is their emotional state? (anxious, busy, resistant, open, warm, deflecting?)
- What are they not saying? (avoiding commitment? hiding a reason? genuinely interested but blocked?)
- Has anything concrete been agreed to, or are we still in vague territory?

Then decide what a skilled coach would do:
- A great coach reads between the lines and responds to the real situation, not just the words
- They never accept vague non-commitments as a win ("I'll check the schedule" is not a yes)
- They make the next step smaller when someone is hesitating
- They back off gracefully when someone is clearly done
- They escalate when something needs a human (complaint, injury, billing, strong emotion)

## What "success" actually means
The goal is only achieved when the member has made a CONCRETE commitment:
- Named a specific day, class, or time they will attend, OR
- Agreed to a specific next step (e.g. "yes, hold a spot for me Tuesday")

Vague positive replies ("I'll try to make it", "I'll check the schedule", "things have been busy", "maybe soon") mean the conversation is still open. Keep moving toward something concrete — gently, patiently, without pressure.

## Output format
Think through what's happening first, then produce ONLY valid JSON (no markdown fences):

{
  "reasoning": "2-3 sentences explaining what the member is actually communicating and what a good coach would do",
  "action": "reply" | "close" | "escalate" | "reopen",
  "reply": "the message to send (if action is reply, close with warm message, or reopen)",
  "newGoal": "only if action is reopen — describe the new task",
  "scoreReason": "one sentence on outcome quality",
  "outcomeScore": 0-100,
  "resolved": true | false
}

## Reply writing rules
- 2-3 sentences max
- Coach voice: warm, direct, first name only
- One question OR one offer — never both in the same message
- No em-dashes
- No exclamation points unless genuinely celebratory
- Sound human — short sentences, natural rhythm, no corporate words`

  const prompt = `Conversation with ${memberName}:\n\n${convoText}\n\nReason through this carefully, then decide what the retention agent should do next.`

  try {
    console.log('evaluateReply: calling Claude Sonnet...')
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    console.log('evaluateReply: Claude Sonnet responded')

    const text = (response.content[0] as any).text?.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(cleaned)

    // Log reasoning for observability — visible in Vercel function logs
    if (result.reasoning) {
      console.log(`evaluateReply reasoning: ${result.reasoning}`)
    }
    console.log(`evaluateReply decision: action=${result.action} score=${result.outcomeScore} resolved=${result.resolved}`)

    return result
  } catch (err) {
    console.error('evaluateReply error:', err)
    // Safe default — escalate rather than auto-send bad content
    return { action: 'escalate', scoreReason: 'AI evaluation failed', outcomeScore: 0, resolved: false }
  }
}

async function sendReply({
  actionId, actionDbId, gymId, memberEmail, memberName, reply, content, shadowTaskId,
}: {
  actionId: string      // replyToken — for email address + conversations table
  actionDbId: string    // DB UUID — for agent_actions updates
  gymId?: string
  memberEmail: string
  memberName: string
  reply: string
  content: any
  shadowTaskId?: string | null
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

  // ── Phase 1 dual-write: outbound_messages + task_conversations ──
  try {
    const resolvedGymId = (gymId === 'demo' || !gymId) ? DEMO_GYM_ID : gymId

    // outbound_messages row
    await supabaseAdmin.from('outbound_messages').insert({
      gym_id: resolvedGymId,
      task_id: shadowTaskId ?? null,
      sent_by_agent: 'retention',
      channel: 'email',
      recipient_email: memberEmail,
      recipient_name: memberName,
      subject,
      body: reply,
      reply_token: actionId,
      status: 'sent',
      provider: sent ? 'gmail' : 'resend',
    })

    // agent reply row in task_conversations
    if (shadowTaskId) {
      await appendConversation(shadowTaskId, {
        gymId: resolvedGymId,
        role: 'agent',
        content: reply,
        agentName: 'retention',
      })
    }
  } catch (dualWriteErr) {
    console.error('sendReply: dual-write (outbound) error — continuing', dualWriteErr)
  }
  // ───────────────────────────────────────────────────────────────
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
