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
import { publishEvent } from './events'
import type { GymInsight } from '../agents/GMAgent'

/** Max autopilot messages per gym per day */
export const DAILY_AUTOPILOT_LIMIT = 10

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

  const task = data as AgentTask

  // Publish TaskCreated event (fire-and-forget — never block task creation)
  publishEvent({
    gymId: task.gym_id,
    eventType: 'TaskCreated',
    aggregateId: task.id,
    aggregateType: 'task',
    payload: {
      taskId: task.id,
      taskType: task.task_type,
      assignedAgent: task.assigned_agent,
      memberEmail: task.member_email,
      memberName: task.member_name,
      requiresApproval: task.requires_approval,
    },
  }).catch(err => {
    console.warn('[tasks] Failed to publish TaskCreated event:', (err as Error).message)
  })

  return task
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

  // Publish lifecycle events (fire-and-forget — never block status updates)
  if (status === 'resolved' || status === 'escalated') {
    // Need gym_id for the event — fetch the task
    supabaseAdmin
      .from('agent_tasks')
      .select('gym_id, task_type, member_email, assigned_agent')
      .eq('id', taskId)
      .single()
      .then(({ data: task }) => {
        if (!task) return
        const eventType = status === 'resolved' ? 'TaskCompleted' : 'TaskEscalated'
        return publishEvent({
          gymId: task.gym_id,
          eventType,
          aggregateId: taskId,
          aggregateType: 'task',
          payload: {
            taskId,
            taskType: task.task_type,
            assignedAgent: task.assigned_agent,
            memberEmail: task.member_email,
            status,
            outcome: opts?.outcome ?? null,
            outcomeScore: opts?.outcomeScore ?? null,
            outcomeReason: opts?.outcomeReason ?? null,
          },
        })
      })
      .catch(err => {
        console.warn(`[tasks] Failed to publish ${status} event:`, (err as Error).message)
      })
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
// Autopilot levels:
//   draft_only  → all tasks require approval
//   smart       → routine messages auto-send; escalations + edge cases need approval
//   full_auto   → everything auto-sends except escalations
//
// Shadow mode: first 7 days after enabling smart/full_auto, tasks still
// require approval but context notes they would have auto-sent.
// ============================================================
export async function createInsightTask(params: {
  gymId: string
  insight: GymInsight
  causationEventId?: string
}): Promise<AgentTask> {
  let requiresApproval = true
  let wouldAutoSend = false

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('autopilot_enabled, autopilot_enabled_at, autopilot_level')
    .eq('id', params.gymId)
    .single()

  const autopilotLevel = (gym?.autopilot_level ?? 'draft_only') as string
  const isEscalation = params.insight.priority === 'critical' || params.insight.type === 'payment_failed'

  if (gym?.autopilot_enabled && autopilotLevel !== 'draft_only') {
    // Escalations always require approval, regardless of level
    if (!isEscalation) {
      // Determine if this task type qualifies for auto-send at this level
      let qualifies = false

      if (autopilotLevel === 'full_auto') {
        // Everything except escalations
        qualifies = true
      } else if (autopilotLevel === 'smart') {
        // Routine: churn_risk (medium/high), win_back, lead_followup, onboarding
        const routineTypes = ['churn_risk', 'renewal_at_risk', 'win_back', 'lead_followup', 'lead_going_cold', 'new_member_onboarding', 'onboarding', 'no_show']
        qualifies = routineTypes.includes(params.insight.type)
      }

      if (qualifies) {
        // Check shadow mode: first 7 days after enabling
        const enabledAt = gym.autopilot_enabled_at ? new Date(gym.autopilot_enabled_at) : new Date()
        const shadowEnd = new Date(enabledAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        const inShadowMode = shadowEnd > new Date()

        if (inShadowMode) {
          // Still require approval, but flag it
          wouldAutoSend = true
        } else {
          // Check daily send limit before allowing auto-send
          const todayCount = await getAutopilotSendCountToday(params.gymId)
          if (todayCount >= DAILY_AUTOPILOT_LIMIT) {
            // Over limit — queue for manual approval
            wouldAutoSend = true // mark in context so owner knows why
          } else {
            requiresApproval = false
          }
        }
      }
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
      ...(wouldAutoSend ? { shadowMode: true, wouldAutoSend: true } : {}),
    },
    requiresApproval,
  })
}

// ============================================================
// getAutopilotSendCountToday
// Counts auto-sent tasks (requires_approval=false, non-ad_hoc) for a gym today.
// Used to enforce the daily autopilot send limit.
// ============================================================
export async function getAutopilotSendCountToday(gymId: string): Promise<number> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { count, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gymId)
    .eq('requires_approval', false)
    .neq('task_type', 'ad_hoc')
    .gte('created_at', todayStart.toISOString())

  if (error) {
    console.warn('getAutopilotSendCountToday failed:', error.message)
    return 0
  }

  return count ?? 0
}
