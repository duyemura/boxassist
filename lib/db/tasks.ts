import { supabaseAdmin } from '../supabase'
import type {
  AgentTask,
  AgentTaskInsert,
  TaskConversationMessage,
  TaskStatus,
  TaskOutcome,
  CreateTaskParams,
  UpdateTaskStatusOpts,
  AppendConversationParams,
} from '../types/agents'

// Fixed UUID for the PushPress East demo gym.
// Corresponds to the row inserted by migration 001_phase1_agent_tasks.sql.
export const DEMO_GYM_ID = '00000000-0000-0000-0000-000000000001'

// ============================================================
// createTask
// ============================================================
export async function createTask(params: CreateTaskParams): Promise<AgentTask> {
  const insert: AgentTaskInsert = {
    gym_id: params.gymId,
    assigned_agent: params.assignedAgent,
    task_type: params.taskType,
    member_email: params.memberEmail ?? null,
    member_name: params.memberName ?? null,
    goal: params.goal,
    context: params.context ?? {},
    requires_approval: params.requiresApproval ?? false,
    legacy_action_id: params.legacyActionId ?? null,
    status: 'open',
  }

  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .insert(insert)
    .select('*')
    .single()

  if (error) {
    throw new Error(`createTask failed: ${error.message}`)
  }

  return data as AgentTask
}

// ============================================================
// getTask
// ============================================================
export async function getTask(taskId: string): Promise<AgentTask | null> {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null  // no rows
    throw new Error(`getTask failed: ${error.message}`)
  }

  return data as AgentTask | null
}

// ============================================================
// updateTaskStatus
// ============================================================
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  opts?: UpdateTaskStatusOpts,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (opts?.outcome !== undefined) updates.outcome = opts.outcome
  if (opts?.outcomeScore !== undefined) updates.outcome_score = opts.outcomeScore
  if (opts?.outcomeReason !== undefined) updates.outcome_reason = opts.outcomeReason
  if (opts?.nextActionAt !== undefined) updates.next_action_at = opts.nextActionAt.toISOString()
  if (status === 'resolved') updates.resolved_at = new Date().toISOString()

  const { error } = await supabaseAdmin
    .from('agent_tasks')
    .update(updates)
    .eq('id', taskId)

  if (error) {
    throw new Error(`updateTaskStatus failed: ${error.message}`)
  }
}

// ============================================================
// appendConversation
// ============================================================
export async function appendConversation(
  taskId: string,
  msg: AppendConversationParams,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('task_conversations')
    .insert({
      task_id: taskId,
      gym_id: msg.gymId,
      role: msg.role,
      content: msg.content,
      agent_name: msg.agentName ?? null,
      evaluation: msg.evaluation ?? null,
    })

  if (error) {
    throw new Error(`appendConversation failed: ${error.message}`)
  }
}

// ============================================================
// getConversationHistory
// ============================================================
export async function getConversationHistory(taskId: string): Promise<TaskConversationMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('task_conversations')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`getConversationHistory failed: ${error.message}`)
  }

  return (data ?? []) as TaskConversationMessage[]
}

// ============================================================
// getOpenTasksForGym
// ============================================================
export async function getOpenTasksForGym(gymId: string): Promise<AgentTask[]> {
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('gym_id', gymId)
    .in('status', ['open', 'awaiting_reply', 'awaiting_approval', 'in_progress', 'escalated'])
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`getOpenTasksForGym failed: ${error.message}`)
  }

  return (data ?? []) as AgentTask[]
}

// ============================================================
// getOrCreateTaskForAction
// Used by reply-agent to find/create the agent_tasks shadow row
// for a legacy agent_actions action during the migration period.
// ============================================================
export async function getOrCreateTaskForAction(action: {
  id: string
  content?: Record<string, unknown>
}): Promise<string | null> {
  try {
    // 1. Look for existing task backed by this legacy action
    const { data: existing } = await supabaseAdmin
      .from('agent_tasks')
      .select('id')
      .eq('legacy_action_id', action.id)
      .single()

    if (existing) return existing.id as string

    // 2. Create one
    const content = action.content as any ?? {}
    const { data: created, error } = await supabaseAdmin
      .from('agent_tasks')
      .insert({
        gym_id: DEMO_GYM_ID,
        assigned_agent: 'retention',
        task_type: 'manual',
        member_email: content.memberEmail ?? null,
        member_name: content.memberName ?? null,
        goal: content.recommendedAction ?? content.playbookGoal ?? 'Re-engage member',
        context: { legacyAction: true },
        legacy_action_id: action.id,
        status: 'open',
      })
      .select('id')
      .single()

    if (error) {
      console.error('getOrCreateTaskForAction: insert error', error.message)
      return null
    }

    return created?.id ?? null
  } catch (err) {
    console.error('getOrCreateTaskForAction: unexpected error', err)
    return null
  }
}
