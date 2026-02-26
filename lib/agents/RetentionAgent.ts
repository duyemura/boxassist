/**
 * RetentionAgent — handles member re-engagement conversations.
 *
 * Loads task-skill markdown files at runtime for context-aware evaluation.
 * Dependency-injected: no hardcoded imports of supabase, claude, or resend.
 * All external calls go through the AgentDeps interface.
 */
import { BaseAgent } from './BaseAgent'
import type { TaskEvaluation, TaskOutcome } from '../types/agents'
import { buildEvaluationPrompt } from '../skill-loader'

/** Fallback prompt when skill loading fails */
const FALLBACK_SYSTEM_PROMPT = `You are a retention agent for a gym. Evaluate the conversation and decide the best next action.

## Output format
Respond ONLY with valid JSON (no markdown fences):

{
  "reasoning": "2-3 sentences on what the member is communicating",
  "action": "reply" | "close" | "escalate" | "wait",
  "reply": "the message to send (required for action=reply)",
  "outcomeScore": 0-100,
  "resolved": true | false,
  "scoreReason": "one sentence on outcome quality",
  "outcome": "engaged" | "churned" | "escalated" | "not_applicable"
}`

export class RetentionAgent extends BaseAgent {
  /**
   * Called when a MemberReplyReceived event fires.
   * 1. Loads task
   * 2. Appends the member's reply to conversation
   * 3. Calls evaluateTask
   * 4. Issues the next action (reply/close/escalate)
   */
  async handleReply(params: {
    taskId: string
    memberEmail: string
    replyContent: string
    gymId: string
  }): Promise<void> {
    const { taskId, memberEmail, replyContent, gymId } = params

    // Load task — bail out if not found
    const task = await this.deps.db.getTask(taskId)
    if (!task) {
      console.warn(`RetentionAgent.handleReply: task ${taskId} not found`)
      return
    }

    // Append member message to conversation
    await this.deps.db.appendConversation(taskId, {
      gymId,
      role: 'member',
      content: replyContent,
    })

    // Evaluate with full context
    const evaluation = await this.evaluateTask(taskId)

    // Append agent evaluation/decision to conversation
    await this.deps.db.appendConversation(taskId, {
      gymId,
      role: 'system',
      content: `Agent decision: ${evaluation.action} (score=${evaluation.outcomeScore})`,
      agentName: 'retention',
      evaluation: evaluation as unknown as Record<string, unknown>,
    })

    // Act on the evaluation
    switch (evaluation.action) {
      case 'reply': {
        if (evaluation.reply) {
          await this._sendEmail({
            task,
            gymId,
            recipientEmail: memberEmail,
            recipientName: task.member_name ?? memberEmail,
            reply: evaluation.reply,
          })
          // Append agent reply to conversation
          await this.deps.db.appendConversation(taskId, {
            gymId,
            role: 'agent',
            content: evaluation.reply,
            agentName: 'retention',
          })
        }
        // Keep task in awaiting_reply state
        await this.deps.db.updateTaskStatus(taskId, 'awaiting_reply')
        break
      }

      case 'close': {
        // Send closing reply if provided
        if (evaluation.reply) {
          await this._sendEmail({
            task,
            gymId,
            recipientEmail: memberEmail,
            recipientName: task.member_name ?? memberEmail,
            reply: evaluation.reply,
          })
          await this.deps.db.appendConversation(taskId, {
            gymId,
            role: 'agent',
            content: evaluation.reply,
            agentName: 'retention',
          })
        }
        await this.deps.db.updateTaskStatus(taskId, 'resolved', {
          outcome: evaluation.outcome ?? 'engaged',
          outcomeScore: evaluation.outcomeScore,
          outcomeReason: evaluation.scoreReason,
        })
        break
      }

      case 'escalate': {
        await this.deps.db.updateTaskStatus(taskId, 'escalated', {
          outcome: 'escalated',
          outcomeScore: evaluation.outcomeScore,
          outcomeReason: evaluation.scoreReason,
        })
        // Publish event for human review
        await this.deps.events.publishEvent({
          gymId,
          eventType: 'TaskEscalated',
          aggregateId: taskId,
          aggregateType: 'task',
          payload: {
            taskId,
            reason: evaluation.scoreReason,
            memberEmail,
          },
        })
        break
      }

      case 'wait':
      default:
        // Nothing to do — task stays in current status
        break
    }
  }

  /**
   * Core reasoning — loads task + full conversation, calls Claude, returns structured decision.
   * Loads the appropriate task-skill prompt based on task_type.
   */
  async evaluateTask(taskId: string): Promise<TaskEvaluation> {
    try {
      const task = await this.deps.db.getTask(taskId)
      const history = await this.deps.db.getConversationHistory(taskId)

      const gymName = (task?.context as any)?.gymName ?? 'the gym'
      const memberName = task?.member_name ?? 'the member'
      const goal = task?.goal ?? 'Re-engage the member'
      const taskType = task?.task_type ?? 'churn_risk'

      // Load skill-aware system prompt based on task type
      let systemPrompt: string
      try {
        systemPrompt = await buildEvaluationPrompt(taskType)
      } catch {
        systemPrompt = FALLBACK_SYSTEM_PROMPT
      }

      // Build conversation text for Claude
      const convoLines = history
        .filter(m => m.role !== 'system') // exclude internal system messages
        .map(m => {
          const label = m.role === 'agent' ? 'GYM' : 'MEMBER'
          return `[${label}]: ${m.content}`
        })
        .join('\n\n')

      const prompt = `Goal: ${goal}
Gym: ${gymName}
Member: ${memberName}

Conversation:
${convoLines || '(no conversation history yet)'}

Evaluate the conversation and decide the best next action. Return only valid JSON.`

      const raw = await this.deps.claude.evaluate(systemPrompt, prompt)
      return this._parseEvaluation(raw)
    } catch (err) {
      console.error('RetentionAgent.evaluateTask error:', err)
      return this._fallbackEscalate('AI evaluation failed')
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _sendEmail(params: {
    task: Awaited<ReturnType<AgentRetentionAgent['deps']['db']['getTask']>>
    gymId: string
    recipientEmail: string
    recipientName: string
    reply: string
  }) {
    const { task, gymId, recipientEmail, recipientName, reply } = params
    const subject = 'Re: Checking in'

    // Convert plain text to simple HTML
    const html = reply
      .split('\n')
      .filter(l => l.trim())
      .map(l => `<p>${l}</p>`)
      .join('')

    await this.deps.mailer.sendEmail({
      to: recipientEmail,
      subject,
      html,
      recipientName,
    })
  }

  private _parseEvaluation(raw: string): TaskEvaluation {
    try {
      // Try to extract JSON from potentially prose-wrapped response
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON found in response')

      const parsed = JSON.parse(match[0])

      return {
        reasoning: parsed.reasoning ?? '',
        action: parsed.action ?? 'escalate',
        reply: parsed.reply,
        outcomeScore: typeof parsed.outcomeScore === 'number' ? parsed.outcomeScore : 0,
        resolved: Boolean(parsed.resolved),
        scoreReason: parsed.scoreReason ?? '',
        outcome: parsed.outcome as TaskOutcome | undefined,
      }
    } catch {
      return this._fallbackEscalate('Failed to parse AI response')
    }
  }

  private _fallbackEscalate(reason: string): TaskEvaluation {
    return {
      reasoning: reason,
      action: 'escalate',
      outcomeScore: 0,
      resolved: false,
      scoreReason: reason,
    }
  }
}

// Type alias for private method type inference
type AgentRetentionAgent = RetentionAgent
