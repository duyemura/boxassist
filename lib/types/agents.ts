// ============================================================
// GymAgents Architecture — Phase 1 Types
// ============================================================

// ------------------------------------
// Primitive union types
// ------------------------------------

export type AgentEventType =
  | 'LeadCreated'
  | 'LeadNoShow'
  | 'MemberCreated'
  | 'AttendanceRecorded'
  | 'AttendanceDrop'
  | 'PaymentFailed'
  | 'PaymentRecovered'
  | 'MemberCancelled'
  | 'MemberReplyReceived'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'TaskEscalated'
  | 'CommandSucceeded'
  | 'CommandFailed'

export type TaskStatus =
  | 'open'
  | 'awaiting_reply'
  | 'awaiting_approval'
  | 'in_progress'
  | 'resolved'
  | 'escalated'
  | 'cancelled'

export type TaskOutcome =
  | 'converted'
  | 'recovered'
  | 'engaged'
  | 'unresponsive'
  | 'churned'
  | 'escalated'
  | 'not_applicable'

export type AgentName = 'retention' | 'sales' | 'gm'

export type MessageChannel = 'email' | 'sms'

export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'opted_out'

export type ConversationRole = 'agent' | 'member' | 'system'

export type MessageProvider = 'resend' | 'twilio'

// ------------------------------------
// agent_tasks table
// ------------------------------------

export interface AgentTask {
  id: string
  account_id: string
  /** @deprecated alias — DB column is gym_id in some tables; prefer account_id */
  gym_id?: string
  assigned_agent: AgentName
  created_by_agent: AgentName
  task_type: string                   // 'attendance_drop_intervention' | 'no_show_recovery' | 'lead_followup' | 'churn_prevention' | 'manual'
  member_id: string | null
  lead_id: string | null
  member_email: string | null
  member_name: string | null
  goal: string
  context: Record<string, unknown>
  status: TaskStatus
  next_action_at: string | null       // ISO 8601
  requires_approval: boolean
  approved_at: string | null          // ISO 8601
  approved_by: string | null          // UUID
  outcome: TaskOutcome | null
  outcome_score: number | null        // 0–100
  outcome_reason: string | null
  resolved_at: string | null          // ISO 8601
  causation_event_id: string | null   // UUID — the agent_event that triggered this task
  legacy_action_id: string | null     // UUID — FK to agent_actions for migration period
  created_at: string                  // ISO 8601
  updated_at: string                  // ISO 8601
}

export interface AgentTaskInsert {
  account_id: string
  assigned_agent: AgentName
  created_by_agent?: AgentName
  task_type: string
  member_id?: string | null
  lead_id?: string | null
  member_email?: string | null
  member_name?: string | null
  goal: string
  context?: Record<string, unknown>
  status?: TaskStatus
  next_action_at?: string | null
  requires_approval?: boolean
  approved_at?: string | null
  approved_by?: string | null
  outcome?: TaskOutcome | null
  outcome_score?: number | null
  outcome_reason?: string | null
  resolved_at?: string | null
  causation_event_id?: string | null
  legacy_action_id?: string | null
}

// ------------------------------------
// task_conversations table
// ------------------------------------

export interface TaskConversationMessage {
  id: string
  task_id: string
  account_id: string
  role: ConversationRole
  content: string
  agent_name: string | null
  evaluation: TaskEvaluation | null
  created_at: string                  // ISO 8601
}

// ------------------------------------
// outbound_messages table
// ------------------------------------

export interface OutboundMessage {
  id: string
  account_id: string
  task_id: string | null
  sent_by_agent: string
  channel: MessageChannel
  recipient_email: string | null
  recipient_phone: string | null
  recipient_name: string | null
  subject: string | null
  body: string
  reply_token: string | null
  status: MessageStatus
  provider: MessageProvider | null
  provider_message_id: string | null
  delivered_at: string | null         // ISO 8601
  failed_reason: string | null
  replied_at: string | null           // ISO 8601
  created_at: string                  // ISO 8601
  updated_at: string                  // ISO 8601
}

// ------------------------------------
// agent_events table
// ------------------------------------

export interface AgentEvent {
  id: string
  account_id: string
  event_type: AgentEventType
  aggregate_id: string                // e.g. member UUID, lead UUID
  aggregate_type: string              // e.g. 'member', 'lead', 'task'
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  published: boolean
  published_at: string | null         // ISO 8601
  created_at: string                  // ISO 8601
}

// ------------------------------------
// communication_optouts table
// ------------------------------------

export interface CommunicationOptout {
  id: string
  account_id: string
  channel: MessageChannel
  contact: string                     // email or phone
  opted_out_at: string                // ISO 8601
  reason: string | null
}

// ------------------------------------
// Evaluation result from Claude
// ------------------------------------

export interface TaskEvaluation {
  reasoning: string
  action: 'reply' | 'close' | 'escalate' | 'wait'
  reply?: string
  outcomeScore: number                // 0–100
  resolved: boolean
  scoreReason: string
  outcome?: TaskOutcome
  /** Notable facts extracted from the conversation (e.g. "prefers morning classes") */
  noteworthy?: string[]
}

// ------------------------------------
// outbound_messages INSERT
// ------------------------------------

export interface OutboundMessageInsert {
  account_id: string
  task_id: string | null
  sent_by_agent: string
  channel: MessageChannel
  recipient_email?: string | null
  recipient_phone?: string | null
  recipient_name?: string | null
  subject?: string | null
  body: string
  reply_token?: string | null
  status: MessageStatus
  provider?: MessageProvider | null
  [key: string]: unknown
}

// ------------------------------------
// Helpers used by db helpers
// ------------------------------------

export interface CreateTaskParams {
  accountId: string
  assignedAgent: AgentName
  taskType: string
  memberEmail?: string
  memberName?: string
  goal: string
  context?: Record<string, unknown>
  requiresApproval?: boolean
  legacyActionId?: string
}

export interface UpdateTaskStatusOpts {
  outcome?: TaskOutcome
  outcomeScore?: number
  outcomeReason?: string
  nextActionAt?: Date
}

export interface AppendConversationParams {
  accountId: string
  role: ConversationRole
  content: string
  agentName?: string
  evaluation?: Record<string, unknown>
}

export interface PublishEventParams {
  accountId: string
  eventType: AgentEventType
  aggregateId: string
  aggregateType: string
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
}
