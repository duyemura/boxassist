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
import { createMemory, getAccountMemories } from '../db/memories'

/** Fallback prompt when skill loading fails */
const FALLBACK_SYSTEM_PROMPT = `You are a retention agent for a subscription business. Evaluate the conversation and decide the best next action.

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
    accountId: string
  }): Promise<void> {
    const { taskId, memberEmail, replyContent, accountId } = params

    // Load task — bail out if not found
    const task = await this.deps.db.getTask(taskId)
    if (!task) {
      console.warn(`RetentionAgent.handleReply: task ${taskId} not found`)
      return
    }

    // Append member message to conversation
    await this.deps.db.appendConversation(taskId, {
      accountId,
      role: 'member',
      content: replyContent,
    })

    // Evaluate with full context (pass accountId for memory injection)
    const evaluation = await this.evaluateTask(taskId, { accountId })

    // Append agent evaluation/decision to conversation
    await this.deps.db.appendConversation(taskId, {
      accountId,
      role: 'system',
      content: `Agent decision: ${evaluation.action} (score=${evaluation.outcomeScore})`,
      agentName: 'retention',
      evaluation: evaluation as unknown as Record<string, unknown>,
    })

    // Save noteworthy facts as gym memories (fire-and-forget — never block the reply loop)
    if (evaluation.noteworthy?.length && accountId) {
      this._saveNoteworthyFacts(accountId, memberEmail, evaluation.noteworthy).catch(err => {
        console.warn('[RetentionAgent] Failed to save noteworthy facts:', (err as Error).message)
      })
    }

    // Act on the evaluation
    switch (evaluation.action) {
      case 'reply': {
        if (evaluation.reply) {
          await this._sendEmail({
            task,
            accountId,
            recipientEmail: memberEmail,
            recipientName: task.member_name ?? memberEmail,
            reply: evaluation.reply,
          })
          // Append agent reply to conversation
          await this.deps.db.appendConversation(taskId, {
            accountId,
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
            accountId,
            recipientEmail: memberEmail,
            recipientName: task.member_name ?? memberEmail,
            reply: evaluation.reply,
          })
          await this.deps.db.appendConversation(taskId, {
            accountId,
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
          accountId,
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
   * Pass accountId to inject gym-specific memories into the prompt.
   */
  async evaluateTask(
    taskId: string,
    opts?: { accountId?: string },
  ): Promise<TaskEvaluation> {
    try {
      const task = await this.deps.db.getTask(taskId)
      const history = await this.deps.db.getConversationHistory(taskId)

      const accountName = (task?.context as any)?.accountName ?? 'the gym'
      const memberName = task?.member_name ?? 'the member'
      const goal = task?.goal ?? 'Re-engage the member'
      const taskType = task?.task_type ?? 'churn_risk'
      const accountId = opts?.accountId ?? task?.gym_id ?? task?.account_id

      // Load skill-aware system prompt based on task type (with memories if accountId available)
      let systemPrompt: string
      try {
        systemPrompt = await buildEvaluationPrompt(taskType, {
          accountId,
          memberId: task?.member_email ?? undefined, // member_id would be better, but email is what we have
        })
      } catch {
        systemPrompt = FALLBACK_SYSTEM_PROMPT
      }

      // Build conversation text for Claude
      const convoLines = history
        .filter(m => m.role !== 'system') // exclude internal system messages
        .map(m => {
          const label = m.role === 'agent' ? 'BUSINESS' : 'MEMBER'
          return `[${label}]: ${m.content}`
        })
        .join('\n\n')

      const prompt = `Goal: ${goal}
Gym: ${accountName}
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
    accountId: string
    recipientEmail: string
    recipientName: string
    reply: string
  }) {
    const { task, accountId, recipientEmail, recipientName, reply } = params
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

  /**
   * Save noteworthy member facts as gym_memories.
   * Deduplicates against existing memories for this member.
   */
  private async _saveNoteworthyFacts(
    accountId: string,
    memberId: string,
    facts: string[],
  ): Promise<void> {
    // Load existing member memories for deduplication
    let existing: string[] = []
    try {
      const memories = await getAccountMemories(accountId, {
        memberId,
        category: 'member_fact',
      })
      existing = memories.map(m => m.content.toLowerCase())
    } catch {
      // If we can't check for dupes, save anyway
    }

    for (const fact of facts) {
      const normalized = fact.trim()
      if (!normalized || normalized.length < 3) continue

      // Skip if a similar memory already exists
      const isDupe = existing.some(e =>
        e === normalized.toLowerCase() ||
        e.includes(normalized.toLowerCase()) ||
        normalized.toLowerCase().includes(e)
      )
      if (isDupe) continue

      await createMemory({
        accountId,
        category: 'member_fact',
        content: normalized,
        importance: 3,
        scope: 'retention',
        memberId,
        source: 'agent',
      })
    }
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
        noteworthy: Array.isArray(parsed.noteworthy) ? parsed.noteworthy.filter((n: unknown) => typeof n === 'string') : undefined,
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
