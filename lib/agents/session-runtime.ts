/**
 * Session runtime — the core engine for goal-driven, chat-based agent sessions.
 *
 * A session is a persistent conversation that spans multiple turns.
 * The agent pulls data on demand via tools, works in steps the owner
 * can observe and influence, and learns as it goes.
 *
 * Three autonomy modes:
 * - full_auto: runs to completion without pausing
 * - semi_auto: pauses at non-reversible actions and input requests
 * - turn_based: one turn at a time, owner sends next message
 */

import Anthropic from '@anthropic-ai/sdk'
import { v4 as uuidv4 } from 'uuid'
import { SONNET } from '../models'
import { loadBaseContext, selectRelevantSkills, buildMultiSkillPrompt } from '../skill-loader'
import { getMemoriesForPrompt } from '../db/memories'
import { supabaseAdmin } from '../supabase'
import { calcCost } from '../cost'
import {
  ensureToolsRegistered,
  getToolsForGroups,
  getToolByName,
  toAnthropicTools,
} from './tools'
import { getComposioToolsForAccount } from '../integrations/composio'
import type {
  SessionConfig,
  SessionEvent,
  ResumeInput,
  AgentSession,
  SessionStatus,
  AutonomyMode,
  PendingApproval,
  ToolContext,
  WorkingSet,
  SessionContext,
  SessionOutput,
  AgentTool,
} from './tools/types'

// Re-export types for consumers
export type { SessionConfig, SessionEvent, ResumeInput, AgentSession }

// ── Anthropic client (lazy singleton) ───────────────────────────────────

let _anthropic: Anthropic | null = null
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return _anthropic
}

// ── Session DB helpers ──────────────────────────────────────────────────

async function createSessionRecord(session: AgentSession): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_sessions')
    .insert({
      id: session.id,
      account_id: session.accountId,
      agent_id: session.agentId,
      goal: session.goal,
      status: session.status,
      autonomy_mode: session.autonomyMode,
      messages: session.messages,
      system_prompt: session.systemPrompt,
      pending_approvals: session.pendingApprovals,
      tools_enabled: session.toolsEnabled,
      turn_count: session.turnCount,
      max_turns: session.maxTurns,
      model: session.model,
      context: session.context,
      outputs: session.outputs,
      cost_cents: session.costCents,
      budget_cents: session.budgetCents,
      expires_at: session.expiresAt,
      created_by: session.createdBy,
    })

  if (error) throw new Error(`Failed to create session: ${error.message}`)
}

async function updateSessionRecord(session: AgentSession): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_sessions')
    .update({
      status: session.status,
      autonomy_mode: session.autonomyMode,
      messages: session.messages,
      pending_approvals: session.pendingApprovals,
      turn_count: session.turnCount,
      context: session.context,
      outputs: session.outputs,
      cost_cents: session.costCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  if (error) throw new Error(`Failed to update session: ${error.message}`)
}

export async function loadSession(sessionId: string): Promise<AgentSession | null> {
  const { data, error } = await supabaseAdmin
    .from('agent_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to load session: ${error.message}`)
  }

  if (!data) return null

  const row = data as any
  return {
    id: row.id,
    accountId: row.account_id,
    agentId: row.agent_id,
    goal: row.goal,
    status: row.status,
    autonomyMode: row.autonomy_mode,
    messages: row.messages ?? [],
    systemPrompt: row.system_prompt ?? '',
    pendingApprovals: row.pending_approvals ?? [],
    toolsEnabled: row.tools_enabled ?? ['data', 'learning'],
    turnCount: row.turn_count ?? 0,
    maxTurns: row.max_turns ?? 20,
    model: row.model ?? SONNET,
    context: row.context ?? { workingSet: { processed: [], emailed: [], skipped: [] } },
    outputs: row.outputs ?? [],
    costCents: row.cost_cents ?? 0,
    budgetCents: row.budget_cents ?? 100,
    expiresAt: row.expires_at,
    createdBy: row.created_by ?? 'owner',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── System prompt assembly ──────────────────────────────────────────────

async function buildSystemPrompt(config: SessionConfig): Promise<string> {
  const parts: string[] = []

  // Layer 1: Base context
  try {
    const base = await loadBaseContext()
    if (base) parts.push(base)
  } catch { /* non-fatal */ }

  // Layer 2: Relevant skills
  try {
    const skills = await selectRelevantSkills(config.goal, {
      taskType: config.skillType,
      maxSkills: 3,
    })
    if (skills.length > 0) {
      const skillPrompt = await buildMultiSkillPrompt(skills)
      // buildMultiSkillPrompt includes _base.md, which we already have.
      // Extract just the skill bodies
      const skillBodies = skills.map(s => s.body).join('\n\n---\n\n')
      if (skillBodies) parts.push(skillBodies)
    }
  } catch { /* non-fatal */ }

  // Layer 3: Business memories
  try {
    const memories = await getMemoriesForPrompt(config.accountId)
    if (memories) parts.push(memories)
  } catch { /* non-fatal */ }

  // Layer 4: Owner prompt override
  if (config.systemPromptOverride) {
    parts.push(`## Owner Instructions\n${config.systemPromptOverride}`)
  }

  // Layer 5: Tool usage + autonomy mode instructions
  const mode = config.autonomyMode ?? 'semi_auto'
  parts.push(buildToolInstructions(mode))

  return parts.join('\n\n---\n\n')
}

function buildToolInstructions(mode: AutonomyMode): string {
  const base = `## Tools & Interaction Model

You have tools available. Use them to gather data, take actions, and learn.

- Call data tools to understand the situation before making recommendations
- Call learning tools (suggest_improvement) when you discover something worth remembering
- Call action tools to take concrete steps
- If you're unsure about something or need the owner's judgment, call request_input
- Track your progress: once you've processed a member, they won't appear in subsequent queries
- Be efficient: use filters on get_members to get exactly who you need`

  const modeInstructions: Record<AutonomyMode, string> = {
    full_auto: `\n\nYou are running autonomously (full auto mode). Complete the goal without waiting for input. Use your best judgment on all decisions. If you hit a genuine blocker, note it and move on to what you can accomplish.`,
    semi_auto: `\n\nYou are running with smart breakpoints (semi auto mode). Non-reversible actions (sending messages) will pause for owner approval. Use request_input when you need guidance or have an important question. Between breakpoints, keep working autonomously.`,
    turn_based: `\n\nYou are in conversation mode (turn-based). Complete one meaningful step per turn, then summarize what you did and what you plan to do next. Wait for the owner's next message before continuing.`,
  }

  return base + modeInstructions[mode]
}

// ── Core session functions ──────────────────────────────────────────────

/**
 * Start a new agent session. Returns an async generator of session events.
 */
export async function* startSession(config: SessionConfig): AsyncGenerator<SessionEvent> {
  ensureToolsRegistered()

  const sessionId = uuidv4()
  const mode = config.autonomyMode ?? 'semi_auto'
  const model = config.model ?? SONNET

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(config)

  // Create session record
  const session: AgentSession = {
    id: sessionId,
    accountId: config.accountId,
    agentId: config.agentId ?? null,
    goal: config.goal,
    status: 'active',
    autonomyMode: mode,
    messages: [],
    systemPrompt,
    pendingApprovals: [],
    toolsEnabled: config.tools ?? ['data', 'action', 'learning'],
    turnCount: 0,
    maxTurns: config.maxTurns ?? 20,
    model,
    context: {
      workingSet: { processed: [], emailed: [], skipped: [] },
    },
    outputs: [],
    costCents: 0,
    budgetCents: config.budgetCents ?? 100,
    expiresAt: null,
    createdBy: config.createdBy ?? 'owner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Persist initial session
  await createSessionRecord(session)

  yield { type: 'session_created', sessionId }

  // Add initial user message with the goal
  session.messages.push({
    role: 'user',
    content: config.goal,
  })

  // Run the tool-use loop
  yield* executeLoop(session, config)
}

/**
 * Resume an existing session with owner input, approvals, or webhook data.
 */
export async function* resumeSession(
  sessionId: string,
  input: ResumeInput,
): AsyncGenerator<SessionEvent> {
  ensureToolsRegistered()

  const session = await loadSession(sessionId)
  if (!session) {
    yield { type: 'error', message: 'Session not found' }
    return
  }

  if (session.status === 'completed' || session.status === 'failed') {
    yield { type: 'error', message: `Session is ${session.status} and cannot be resumed` }
    return
  }

  // Handle mode change
  if (input.newMode) {
    session.autonomyMode = input.newMode
  }

  // Handle owner message
  if (input.message) {
    session.messages.push({
      role: 'user',
      content: input.message,
    })
    session.status = 'active'
    session.pendingApprovals = []
  }

  // Handle approvals
  if (input.approvals && session.pendingApprovals.length > 0) {
    const tools = getToolsForGroups(session.toolsEnabled)
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const pending of session.pendingApprovals) {
      const approved = input.approvals[pending.toolUseId]

      if (approved) {
        // Execute the approved tool
        const tool = tools.find(t => t.name === pending.name) ?? getToolByName(pending.name)
        if (tool) {
          const ctx = buildToolContext(session)
          try {
            const result = await tool.execute(pending.input, ctx)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: pending.toolUseId,
              content: JSON.stringify(result),
            })
            yield { type: 'tool_result', name: pending.name, result }

            // Track outputs
            trackOutput(session, pending.name, result)
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: pending.toolUseId,
              content: JSON.stringify({ error: err.message }),
            })
            yield { type: 'tool_result', name: pending.name, result: { error: err.message } }
          }
        }
      } else {
        // Rejected — tell the agent
        toolResults.push({
          type: 'tool_result',
          tool_use_id: pending.toolUseId,
          content: JSON.stringify({ rejected: true, reason: 'Owner rejected this action.' }),
        })
        yield { type: 'tool_result', name: pending.name, result: { rejected: true } }
      }
    }

    if (toolResults.length > 0) {
      session.messages.push({ role: 'user', content: toolResults })
    }

    session.status = 'active'
    session.pendingApprovals = []
  }

  // Handle webhook reply (waiting_event → active)
  if (input.replyContent && session.status === 'waiting_event') {
    // Find the pending wait_for_reply tool call
    const waitingFor = session.context.waitingFor
    if (waitingFor) {
      // Inject a system message about stale data
      const dormantSince = new Date(session.updatedAt)
      const dormantDays = Math.floor((Date.now() - dormantSince.getTime()) / 86_400_000)

      if (dormantDays > 0) {
        session.messages.push({
          role: 'user',
          content: `[System] This session was dormant for ${dormantDays} day${dormantDays > 1 ? 's' : ''}. Data from your earlier analysis may be outdated. If you need current member status, attendance, or payment data, call the relevant data tools again before taking action.\n\nThe reply you were waiting for has arrived (reply_token: ${input.replyToken ?? waitingFor.replyToken}):\n\n${input.replyContent}`,
        })
      } else {
        session.messages.push({
          role: 'user',
          content: `A reply has arrived (reply_token: ${input.replyToken ?? waitingFor.replyToken}):\n\n${input.replyContent}`,
        })
      }

      session.context.waitingFor = undefined
    }

    session.status = 'active'
  }

  // Continue the loop
  yield* executeLoop(session)
}

// ── The tool-use loop ───────────────────────────────────────────────────

async function* executeLoop(
  session: AgentSession,
  config?: SessionConfig,
): AsyncGenerator<SessionEvent> {
  const client = getAnthropicClient()
  const localTools = getToolsForGroups(session.toolsEnabled)
  const composioTools = await getComposioToolsForAccount(session.accountId)
  const tools = [...localTools, ...composioTools]
  const anthropicTools = toAnthropicTools(tools)

  while (session.turnCount < session.maxTurns) {
    // Budget check
    if (session.costCents >= session.budgetCents) {
      yield { type: 'message', content: 'Budget limit reached. Here is what was accomplished so far.' }
      session.status = 'completed'
      break
    }

    // Make Claude API call
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: session.model,
        max_tokens: 4096,
        system: session.systemPrompt,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        messages: session.messages,
      })
    } catch (err: any) {
      yield { type: 'error', message: `Claude API error: ${err.message}` }
      session.status = 'failed'
      break
    }

    session.turnCount++

    // Track cost
    const { costUsd } = calcCost(
      response.usage.input_tokens,
      response.usage.output_tokens,
      session.model,
    )
    session.costCents += Math.ceil(costUsd * 100)

    // Emit text blocks
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        yield { type: 'message', content: block.text }
      }
    }

    // If no tool use — pause for input (turn_based) or complete (semi_auto + full_auto headless)
    if (response.stop_reason !== 'tool_use') {
      if (session.autonomyMode === 'turn_based') {
        session.status = 'waiting_input'
        yield { type: 'paused', reason: 'Waiting for your next message', status: 'waiting_input' }
      } else {
        // semi_auto + full_auto: used for headless workflow runs — complete the session
        session.status = 'completed'
        const lastText = response.content.find(b => b.type === 'text')
        const summary = lastText && lastText.type === 'text' ? lastText.text.slice(0, 200) : 'Session completed'
        yield { type: 'done', summary }
      }
      break
    }

    // Process tool calls
    session.messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    const pendingApprovals: PendingApproval[] = []
    const ctx = buildToolContext(session)

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const tool = tools.find(t => t.name === block.name) ?? getToolByName(block.name)
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
        })
        continue
      }

      const input = (block.input ?? {}) as Record<string, unknown>

      // Determine if this tool should pause
      const shouldPause = shouldToolPause(tool, input, session.autonomyMode, ctx)

      // Special handling for wait_for_reply
      if (tool.name === 'wait_for_reply') {
        const result = await tool.execute(input, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
        yield { type: 'tool_result', name: tool.name, result }

        // Set session to waiting_event
        session.context.waitingFor = { replyToken: input.reply_token as string }
        session.context.nudgeSchedule = {
          nudgesSent: 0,
          nextNudgeAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          maxNudges: 3,
          backoffDays: [2, 5, 10],
        }
        session.status = 'waiting_event'

        // Add tool results so far, then break
        if (toolResults.length > 0) {
          session.messages.push({ role: 'user', content: toolResults })
        }

        yield { type: 'paused', reason: `Waiting for reply (token: ${input.reply_token})`, status: 'waiting_event' }
        await updateSessionRecord(session)
        return
      }

      // Special handling for request_input in full_auto
      if (tool.name === 'request_input' && session.autonomyMode === 'full_auto') {
        const result = { answer: 'You are in full auto mode. Make your best judgment.' }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
        yield { type: 'tool_result', name: tool.name, result }
        continue
      }

      if (shouldPause) {
        pendingApprovals.push({
          toolUseId: block.id,
          name: block.name,
          input,
        })
        yield { type: 'tool_pending', name: block.name, input, toolUseId: block.id }
      } else {
        yield { type: 'tool_call', name: block.name, input }

        try {
          const result = await tool.execute(input, ctx)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
          yield { type: 'tool_result', name: block.name, result }

          // Track outputs
          trackOutput(session, block.name, result)
        } catch (err: any) {
          const errorResult = { error: err.message }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(errorResult),
          })
          yield { type: 'tool_result', name: block.name, result: errorResult }
        }
      }
    }

    // If there are pending approvals, pause
    if (pendingApprovals.length > 0) {
      // Add completed tool results (non-pending) to messages
      // For pending ones, we need to wait — but Claude expects ALL tool results at once.
      // So we pause the entire batch and return pending + completed results on resume.
      session.status = 'waiting_approval'
      session.pendingApprovals = pendingApprovals

      // If we have any completed results, we still need to hold them
      // because Claude expects all results in one user message
      if (toolResults.length > 0) {
        // Store completed results in context so we can reconstruct on resume
        session.context._completedToolResults = toolResults
      }

      yield { type: 'paused', reason: 'Waiting for approval on pending actions', status: 'waiting_approval' }
      await updateSessionRecord(session)
      return
    }

    // Add all tool results
    if (toolResults.length > 0) {
      session.messages.push({ role: 'user', content: toolResults })
    }

    // In turn_based mode, pause after every response
    if (session.autonomyMode === 'turn_based') {
      session.status = 'waiting_input'
      yield { type: 'paused', reason: 'Your turn', status: 'waiting_input' }
      await updateSessionRecord(session)
      return
    }

    // Persist after each turn
    await updateSessionRecord(session)
  }

  // Max turns reached
  if (session.turnCount >= session.maxTurns && session.status === 'active') {
    session.status = 'completed'
    yield { type: 'done', summary: `Completed after ${session.turnCount} turns (max reached)` }
  }

  await updateSessionRecord(session)
}

// ── Helpers ─────────────────────────────────────────────────────────────

function shouldToolPause(
  tool: AgentTool,
  input: Record<string, unknown>,
  mode: AutonomyMode,
  ctx: ToolContext,
): boolean {
  if (mode === 'full_auto') return false
  if (mode === 'turn_based') {
    // In turn_based, only approval-required tools pause mid-turn
    // (the turn itself always pauses after the response)
    if (typeof tool.requiresApproval === 'function') {
      return tool.requiresApproval(input, ctx)
    }
    return tool.requiresApproval === true
  }
  // semi_auto: check the tool's approval policy
  if (typeof tool.requiresApproval === 'function') {
    return tool.requiresApproval(input, ctx)
  }
  return tool.requiresApproval === true
}

function buildToolContext(session: AgentSession): ToolContext {
  return {
    accountId: session.accountId,
    apiKey: (session.context as any)._apiKey ?? '',
    companyId: (session.context as any)._companyId ?? '',
    sessionId: session.id,
    autopilotLevel: (session.context as any)._autopilotLevel ?? 'draft_only',
    autonomyMode: session.autonomyMode,
    workingSet: session.context.workingSet ?? { processed: [], emailed: [], skipped: [] },
  }
}

function trackOutput(
  session: AgentSession,
  toolName: string,
  result: unknown,
): void {
  const r = result as Record<string, unknown> | null
  if (!r) return

  const timestamp = new Date().toISOString()

  if (toolName === 'create_task' && r.taskId) {
    session.outputs.push({
      type: 'task_created',
      data: { taskId: r.taskId },
      timestamp,
    })
  } else if (toolName === 'send_email' && r.messageId) {
    session.outputs.push({
      type: 'email_sent',
      data: { messageId: r.messageId, replyToken: r.replyToken },
      timestamp,
    })
  } else if (toolName === 'suggest_improvement' && r.noted) {
    session.outputs.push({
      type: 'improvement_suggested',
      data: { improvementId: r.improvementId },
      timestamp,
    })
  } else if ((toolName === 'create_artifact' || toolName === 'create_markdown') && r.artifactId) {
    session.outputs.push({
      type: 'artifact_created',
      data: { artifactId: r.artifactId, title: r.title },
      timestamp,
    })
  }
}

// ── Unattended session runner (for cron) ────────────────────────────────

/**
 * Run a session to completion without streaming. Returns the final session state.
 * Used by cron jobs and background processes.
 */
export async function runUnattendedSession(config: SessionConfig): Promise<AgentSession> {
  const events: SessionEvent[] = []

  for await (const event of startSession({
    ...config,
    autonomyMode: 'full_auto',
    createdBy: config.createdBy ?? 'cron',
  })) {
    events.push(event)
  }

  // Load the final session state from DB
  const sessionCreated = events.find(e => e.type === 'session_created') as
    | { type: 'session_created'; sessionId: string }
    | undefined

  if (!sessionCreated) {
    throw new Error('Session was not created')
  }

  const session = await loadSession(sessionCreated.sessionId)
  if (!session) {
    throw new Error('Session not found after completion')
  }

  return session
}

/**
 * Inject PushPress credentials into a session's context.
 * Must be called before the session tries to use data tools.
 */
export function injectCredentials(
  session: AgentSession,
  apiKey: string,
  companyId: string,
  autopilotLevel?: string,
): void {
  ;(session.context as any)._apiKey = apiKey
  ;(session.context as any)._companyId = companyId
  if (autopilotLevel) {
    ;(session.context as any)._autopilotLevel = autopilotLevel
  }
}
