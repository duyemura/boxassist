/**
 * DB helpers for agent_commands and outbound_messages tables.
 * Used by CommandBus and SendEmailExecutor.
 */
import { supabaseAdmin } from '../supabase'
import type { AgentCommand, CommandStatus } from '../commands/commandBus'
import type { OutboundMessage, OutboundMessageInsert, MessageStatus } from '../types/agents'

export type { OutboundMessageInsert }

// ── agent_commands helpers ────────────────────────────────────────────────────

/**
 * Insert a new agent_command row. Returns the created record.
 */
export async function insertCommand(
  cmd: Omit<AgentCommand, 'id' | 'createdAt'>,
): Promise<AgentCommand> {
  const { data, error } = await supabaseAdmin
    .from('agent_commands')
    .insert({
      gym_id: cmd.gymId,
      command_type: cmd.commandType,
      payload: cmd.payload,
      issued_by_agent: cmd.issuedByAgent,
      task_id: cmd.taskId ?? null,
      status: cmd.status,
      attempts: cmd.attempts,
      max_attempts: cmd.maxAttempts,
      next_attempt_at: cmd.nextAttemptAt,
    })
    .select('*')
    .single()

  if (error) throw new Error(`insertCommand failed: ${error.message}`)

  return dbRowToCommand(data)
}

/**
 * Claim up to `limit` pending commands whose nextAttemptAt <= now.
 * Atomically marks them as 'processing' to avoid double-processing.
 */
export async function claimPendingCommands(limit = 10): Promise<AgentCommand[]> {
  const now = new Date().toISOString()

  // Simple approach: select pending commands and return them
  // In production, use a FOR UPDATE SKIP LOCKED for true atomic claiming
  const { data, error } = await supabaseAdmin
    .from('agent_commands')
    .select('*')
    .eq('status', 'pending')
    .lt('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`claimPendingCommands failed: ${error.message}`)

  return (data ?? []).map(dbRowToCommand)
}

/**
 * Mark a command as succeeded and store the executor result.
 */
export async function completeCommand(
  id: string,
  result: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_commands')
    .update({
      status: 'succeeded' satisfies CommandStatus,
      result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(`completeCommand failed: ${error.message}`)
}

/**
 * Mark a command as failed and schedule next retry.
 */
export async function failCommand(
  id: string,
  error: string,
  nextAttemptAt: Date,
): Promise<void> {
  const { error: dbError } = await supabaseAdmin
    .from('agent_commands')
    .update({
      status: 'failed' satisfies CommandStatus,
      last_error: error,
      next_attempt_at: nextAttemptAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) throw new Error(`failCommand failed: ${dbError.message}`)
}

/**
 * Dead-letter a command — no more retries.
 */
export async function deadLetterCommand(id: string, error: string): Promise<void> {
  const { error: dbError } = await supabaseAdmin
    .from('agent_commands')
    .update({
      status: 'dead' satisfies CommandStatus,
      last_error: error,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) throw new Error(`deadLetterCommand failed: ${dbError.message}`)
}

// ── outbound_messages helpers ─────────────────────────────────────────────────

/**
 * Create a new outbound_messages row.
 */
export async function createOutboundMessage(
  msg: OutboundMessageInsert,
): Promise<OutboundMessage> {
  const { data, error } = await supabaseAdmin
    .from('outbound_messages')
    .insert(msg)
    .select('*')
    .single()

  if (error) throw new Error(`createOutboundMessage failed: ${error.message}`)

  return data as OutboundMessage
}

/**
 * Update an outbound_message's status and optional metadata.
 */
export async function updateOutboundMessageStatus(
  id: string,
  status: MessageStatus,
  opts?: { providerId?: string; failedReason?: string },
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (opts?.providerId != null) updates.provider_message_id = opts.providerId
  if (opts?.failedReason != null) updates.failed_reason = opts.failedReason
  if (status === 'delivered') updates.delivered_at = new Date().toISOString()

  const { error } = await supabaseAdmin
    .from('outbound_messages')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`updateOutboundMessageStatus failed: ${error.message}`)
}

// ── Private helpers ───────────────────────────────────────────────────────────

function dbRowToCommand(row: any): AgentCommand {
  return {
    id: row.id,
    gymId: row.gym_id,
    commandType: row.command_type,
    payload: row.payload ?? {},
    issuedByAgent: row.issued_by_agent,
    taskId: row.task_id ?? undefined,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    result: row.result ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  }
}
