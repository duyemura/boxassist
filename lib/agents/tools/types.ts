/**
 * Tool system types for the session-based agent runtime.
 *
 * Tools are the agent's interface to the world. Each tool has:
 * - A schema (for Claude's tool_use)
 * - An execution function (what happens when the agent calls it)
 * - An approval policy (does the owner need to approve before execution?)
 */

import type Anthropic from '@anthropic-ai/sdk'

// ── Tool context (passed to every tool execution) ─────────────────────────

export interface ToolContext {
  accountId: string
  /** Decrypted PushPress API key */
  apiKey: string
  /** PushPress company ID */
  companyId: string
  /** Current session ID */
  sessionId: string
  /** Account autopilot level */
  autopilotLevel: string
  /** Current autonomy mode */
  autonomyMode: AutonomyMode
  /** Session working set — tracks processed members, emails sent, etc. */
  workingSet: WorkingSet
}

export interface WorkingSet {
  /** Member IDs already dealt with in this session */
  processed: string[]
  /** Member IDs emailed in this session */
  emailed: string[]
  /** Member IDs explicitly skipped (with reason) */
  skipped: Array<{ id: string; reason: string }>
}

// ── Autonomy modes ──────────────────────────────────────────────────────

export type AutonomyMode = 'full_auto' | 'semi_auto' | 'turn_based'

// ── Tool definition ──────────────────────────────────────────────────────

export interface AgentTool {
  name: string
  description: string
  input_schema: Anthropic.Tool['input_schema']
  /**
   * Whether this tool needs owner approval before execution.
   * - false: always executes immediately
   * - true: always needs approval (unless full_auto)
   * - function: dynamic based on context (e.g., send_email checks autopilot level)
   */
  requiresApproval: boolean | ((input: Record<string, unknown>, ctx: ToolContext) => boolean)
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export interface ToolGroup {
  name: string
  tools: AgentTool[]
}

// ── Session types ────────────────────────────────────────────────────────

export type SessionStatus =
  | 'active'
  | 'waiting_input'
  | 'waiting_approval'
  | 'waiting_event'
  | 'completed'
  | 'failed'

export type SessionCreatedBy = 'owner' | 'cron' | 'event' | 'system'

export interface PendingApproval {
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

export interface AgentSession {
  id: string
  accountId: string
  agentId: string | null
  goal: string
  status: SessionStatus
  autonomyMode: AutonomyMode
  messages: Anthropic.MessageParam[]
  systemPrompt: string
  pendingApprovals: PendingApproval[]
  toolsEnabled: string[]
  turnCount: number
  maxTurns: number
  model: string
  context: SessionContext
  outputs: SessionOutput[]
  costCents: number
  budgetCents: number
  expiresAt: string | null
  createdBy: SessionCreatedBy
  createdAt: string
  updatedAt: string
}

export interface SessionContext {
  workingSet: WorkingSet
  waitingFor?: { replyToken: string }
  nudgeSchedule?: NudgeSchedule
  improvementCount?: number
  [key: string]: unknown
}

export interface NudgeSchedule {
  nudgesSent: number
  nextNudgeAt: string | null
  maxNudges: number
  backoffDays: number[]
}

export interface SessionOutput {
  type: 'task_created' | 'email_sent' | 'memory_saved' | 'improvement_suggested' | 'artifact_created'
  data: Record<string, unknown>
  timestamp: string
}

// ── Session events (streamed to frontend via SSE) ───────────────────────

export type SessionEvent =
  | { type: 'session_created'; sessionId: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'tool_pending'; name: string; input: unknown; toolUseId: string }
  | { type: 'message'; content: string }
  | { type: 'memory_saved'; content: string }
  | { type: 'task_created'; taskId: string; goal: string }
  | { type: 'paused'; reason: string; status: SessionStatus }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }

// ── Config types ────────────────────────────────────────────────────────

export interface SessionConfig {
  accountId: string
  goal: string
  agentId?: string
  tools?: string[]
  autonomyMode?: AutonomyMode
  maxTurns?: number
  budgetCents?: number
  createdBy?: SessionCreatedBy
  model?: string
  /** PushPress credentials */
  apiKey: string
  companyId: string
  /** Agent's system_prompt override (Layer 4) */
  systemPromptOverride?: string | null
  /** Skill type for prompt assembly */
  skillType?: string
}

export interface ResumeInput {
  /** Owner typed a message */
  message?: string
  /** Approvals for pending tool calls: toolUseId → approved */
  approvals?: Record<string, boolean>
  /** Change autonomy mode */
  newMode?: AutonomyMode
  /** Webhook reply content (for waiting_event sessions) */
  replyContent?: string
  /** Reply token that matched (for waiting_event sessions) */
  replyToken?: string
}
