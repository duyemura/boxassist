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

  // Load conversation history — keyed by replyToken (actionId)
  const { data: history } = await supabaseAdmin
    .from('agent_conversations')
    .select('role, text, created_at')
    .eq('action_id', actionId)
    .order('created_at', { ascending: true })

  const conversation: ConversationMessage[] = [
    { role: 'outbound', text: originalMessage, timestamp: action.created_at },
    ...(history ?? []).map((h: any) => ({ role: h.role, text: h.text, timestamp: h.created_at })),
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

Your job: read the conversation and decide what to do next.

Original goal: "${playbookGoal}"

Options:
- "reply": Conversation needs a follow-up to move toward the goal.
- "close": Goal is achieved OR member clearly isn't interested. Always include a warm closing reply on a positive outcome.
- "escalate": Needs human attention — anger, complaint, complex request, or ambiguous situation.
- "reopen": The thread was closed but the member has introduced NEW context or a new need. Reopen and address it.

Rules:
- Member confirmed they're coming back → close with warm reply ("Can't wait to see you Thursday! 💪")
- Member said firm no or cancelling → close with gracious reply, score low
- Member asked a question you can answer → reply
- Member replied to a closed thread with new context or a new problem → reopen
- Complex, emotional, or unclear → escalate
- Replies: SHORT — 1-2 sentences, warm, first name only, write as gym owner/coach
- ALWAYS include "reply" text when closing positively or reopening

Respond with ONLY valid JSON (no markdown):
{ "action": "reply"|"close"|"escalate"|"reopen", "reply": "string", "newGoal": "string (only for reopen — describe the new task)", "scoreReason": "one sentence", "outcomeScore": 0-100, "resolved": true|false }`

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
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'GymAgents <noreply@lunovoria.resend.app>',
      replyTo,
      to: memberEmail,
      subject,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;line-height:1.6;color:#333;">
        ${reply.split('\n').map(p => `<p style="margin:0 0 12px">${p}</p>`).join('')}
      </div>`,
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
