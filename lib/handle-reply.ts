/**
 * handle-reply.ts — Routes inbound member replies to RetentionAgent.
 *
 * Replaces the legacy reply-agent.ts. All replies now go through
 * agent_tasks + task_conversations via RetentionAgent.
 */
import { RetentionAgent } from './agents/RetentionAgent'
import * as dbTasks from './db/tasks'
import * as dbEvents from './db/events'
import * as dbCommands from './db/commands'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import { SONNET } from './models'

// Lazy singletons — avoids module-level init crashing Next.js build
let _anthropicClient: Anthropic | null = null
const anthropicClient = new Proxy({} as Anthropic, {
  get(_, prop) {
    if (!_anthropicClient) _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    return (_anthropicClient as any)[prop]
  },
})
let _resend: Resend | null = null
const resend = new Proxy({} as Resend, {
  get(_, prop) {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
    return (_resend as any)[prop]
  },
})

/**
 * Build real AgentDeps for RetentionAgent — wired to Supabase, Claude, Resend.
 */
function buildRetentionDeps(taskId: string) {
  return {
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
      sendEmail: async (params: { to: string; subject: string; html: string; replyTo?: string }) => {
        const result = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? 'GymAgents <noreply@lunovoria.resend.app>',
          replyTo: params.replyTo ?? `reply+${taskId}@lunovoria.resend.app`,
          to: params.to,
          subject: params.subject,
          html: params.html,
        })
        return { id: result.data?.id ?? 'unknown' }
      },
    },
    claude: {
      evaluate: async (system: string, prompt: string) => {
        const response = await anthropicClient.messages.create({
          model: SONNET,
          max_tokens: 600,
          system,
          messages: [{ role: 'user', content: prompt }],
        })
        return (response.content[0] as any).text?.trim() ?? ''
      },
    },
  }
}

/**
 * Handle an inbound reply from a member.
 *
 * Looks up the task by reply token (taskId), then routes to RetentionAgent.
 * Used by both /api/webhooks/resend and /api/webhooks/inbound.
 */
export async function handleInboundReply({
  replyToken,
  memberReply,
  memberEmail,
  memberName,
}: {
  replyToken: string
  memberReply: string
  memberEmail: string
  memberName: string
}): Promise<{ processed: boolean; taskId?: string; reason?: string }> {
  // Look up the task — reply token is the task UUID
  const task = await dbTasks.getTask(replyToken)

  if (!task) {
    console.warn(`handleInboundReply: task not found for token ${replyToken}`)
    return { processed: false, reason: 'task_not_found' }
  }

  // Skip if already resolved
  if (task.status === 'resolved' || task.status === 'cancelled') {
    console.log(`handleInboundReply: task ${task.id} already ${task.status}, skipping`)
    return { processed: false, taskId: task.id, reason: `task_already_${task.status}` }
  }

  console.log(`handleInboundReply: routing reply to RetentionAgent for task=${task.id} member="${memberName}"`)

  const deps = buildRetentionDeps(task.id)
  const agent = new RetentionAgent(deps)

  await agent.handleReply({
    taskId: task.id,
    memberEmail,
    replyContent: memberReply,
    accountId: task.gym_id ?? task.account_id,
  })

  console.log(`handleInboundReply: RetentionAgent completed for task ${task.id}`)
  return { processed: true, taskId: task.id }
}

/**
 * Strip quoted reply text — extract only the new reply above the quote line.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return ''
  let t = text.replace(/<[^>]+>/g, ' ')
  const cutPatterns = [
    /\s+On .{5,100}wrote:/,
    /\s+-----Original Message-----/,
    /\s+From:.*@.*\n/,
    /\s+[-]{3,}\s*Forwarded/,
  ]
  for (const pat of cutPatterns) {
    const match = t.search(pat)
    if (match > 0) { t = t.slice(0, match); break }
  }
  const lines = t.split('\n')
  const cutoff = lines.findIndex(line => /^\s*>/.test(line))
  const clean = cutoff > 0 ? lines.slice(0, cutoff) : lines
  return clean.join('\n').replace(/\s+/g, ' ').trim()
}

/**
 * Strip HTML tags to get plain text.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
