/**
 * BaseAgent — abstract base class for all GymAgents agents.
 * Uses dependency injection: all external services (DB, Claude, mailer, etc.)
 * are injected via constructor — NO hardcoded module imports.
 */
import type {
  AgentTask,
  TaskStatus,
  UpdateTaskStatusOpts,
  AppendConversationParams,
  TaskConversationMessage,
  OutboundMessage,
  OutboundMessageInsert,
  MessageStatus,
  PublishEventParams,
} from '../types/agents'

export type { OutboundMessageInsert }

export interface SendEmailParams {
  to: string
  from?: string
  subject: string
  html: string
  replyTo?: string
  recipientName?: string
}

export interface SendSMSParams {
  to: string
  from?: string
  body: string
}

export interface AgentDeps {
  db: {
    getTask: (id: string) => Promise<AgentTask | null>
    updateTaskStatus: (id: string, status: TaskStatus, opts?: UpdateTaskStatusOpts) => Promise<void>
    appendConversation: (taskId: string, msg: AppendConversationParams) => Promise<void>
    getConversationHistory: (taskId: string) => Promise<TaskConversationMessage[]>
    createOutboundMessage: (msg: OutboundMessageInsert) => Promise<OutboundMessage>
    updateOutboundMessageStatus: (
      id: string,
      status: MessageStatus,
      opts?: { providerId?: string; failedReason?: string },
    ) => Promise<void>
  }
  events: {
    publishEvent: (params: PublishEventParams) => Promise<string>
  }
  mailer: {
    sendEmail: (params: SendEmailParams) => Promise<{ id: string }>
  }
  sms?: {
    sendSMS: (params: SendSMSParams) => Promise<{ sid: string }>
  }
  claude: {
    /** Calls Claude with a system prompt + user prompt, returns raw text. */
    evaluate: (system: string, prompt: string) => Promise<string>
  }
}

export abstract class BaseAgent {
  constructor(protected deps: AgentDeps) {}
}
