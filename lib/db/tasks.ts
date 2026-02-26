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
import type { GymInsight } from '../agents/GMAgent'

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
// createAdHocTask
// Creates a task from an owner request (via GM chat or manual entry).
// These never require approval — the owner is already aware of them.
// ============================================================
export async function createAdHocTask(params: {
  gymId: string
  goal: string
  assignedAgent: 'gm' | 'retention' | 'sales'
  taskType?: string
  memberEmail?: string
  memberName?: string
  context?: Record<string, unknown>
}): Promise<AgentTask> {
  return createTask({
    gymId: params.gymId,
    assignedAgent: params.assignedAgent,
    taskType: params.taskType ?? 'ad_hoc',
    memberEmail: params.memberEmail,
    memberName: params.memberName,
    goal: params.goal,
    context: {
      source: 'gm_chat',
      ...params.context,
    },
    requiresApproval: false,
  })
}

// ============================================================
// createInsightTask
// Creates an agent_task from a GMAgent GymInsight.
// Called by GMAgent.runAnalysis and GMAgent.handleEvent.
//
// When gym has autopilot_enabled, tasks skip approval (except escalations).
// During shadow mode (first 7 days), tasks are logged but not auto-sent.
// ============================================================
export async function createInsightTask(params: {
  gymId: string
  insight: GymInsight
  causationEventId?: string
}): Promise<AgentTask> {
  // Check if gym has autopilot enabled
  let requiresApproval = true
  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('autopilot_enabled, autopilot_enabled_at')
    .eq('id', params.gymId)
    .single()

  if (gym?.autopilot_enabled) {
    // Escalations always require approval
    const isEscalation = params.insight.priority === 'critical' || params.insight.type === 'payment_failed'
    if (!isEscalation) {
      // Check shadow mode: first 7 days after enabling
      const enabledAt = gym.autopilot_enabled_at ? new Date(gym.autopilot_enabled_at) : new Date()
      const shadowEnd = new Date(enabledAt.getTime() + 7 * 24 * 60 * 60 * 1000)
      const inShadowMode = shadowEnd > new Date()

      if (!inShadowMode) {
        requiresApproval = false
      }
      // In shadow mode: still requires_approval but context notes it would have auto-sent
    }
  }

  return createTask({
    gymId: params.gymId,
    assignedAgent: 'retention',
    taskType: params.insight.type,
    memberEmail: params.insight.memberEmail,
    memberName: params.insight.memberName,
    goal: params.insight.title,
    context: {
      insightType: params.insight.type,
      insightDetail: params.insight.detail,
      estimatedImpact: params.insight.estimatedImpact,
      draftMessage: params.insight.draftMessage,
      recommendedAction: params.insight.recommendedAction,
      priority: params.insight.priority,
    },
    requiresApproval,
  })
}
