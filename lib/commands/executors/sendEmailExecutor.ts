/**
 * SendEmailExecutor — executes SendEmail commands.
 *
 * Flow:
 *   1. Creates outbound_messages row with status='queued'
 *   2. Calls mailer.sendEmail
 *   3. Updates status to 'sent' with provider ID
 *   4. On failure: updates status to 'failed', rethrows for CommandBus retry
 */
import type { CommandExecutor, AgentCommand } from '../commandBus'

export interface SendEmailPayload {
  recipientEmail: string
  recipientName: string
  subject: string
  body: string          // HTML
  replyToken?: string
  taskId?: string
  gymId: string
  sentByAgent: string
}

export interface SendEmailExecutorDeps {
  mailer: {
    sendEmail: (params: {
      to: string
      subject: string
      html: string
      recipientName?: string
      replyTo?: string
      [key: string]: unknown
    }) => Promise<{ id: string }>
  }
  db: {
    createOutboundMessage: (msg: {
      gym_id: string
      task_id: string | null
      sent_by_agent: string
      channel: 'email'
      recipient_email: string
      recipient_name: string
      subject: string
      body: string
      reply_token: string | null
      status: 'queued'
      [key: string]: unknown
    }) => Promise<{ id: string }>
    updateOutboundMessageStatus: (
      id: string,
      status: string,
      opts?: { providerId?: string; failedReason?: string },
    ) => Promise<void>
  }
}

export class SendEmailExecutor implements CommandExecutor {
  constructor(private deps: SendEmailExecutorDeps) {}

  async execute(command: AgentCommand): Promise<Record<string, unknown>> {
    const payload = command.payload as unknown as SendEmailPayload

    // Step 1: Create outbound_messages row with status=queued (before sending)
    const outbound = await this.deps.db.createOutboundMessage({
      gym_id: payload.gymId,
      task_id: payload.taskId ?? null,
      sent_by_agent: payload.sentByAgent,
      channel: 'email',
      recipient_email: payload.recipientEmail,
      recipient_name: payload.recipientName,
      subject: payload.subject,
      body: payload.body,
      reply_token: payload.replyToken ?? null,
      status: 'queued',
    })

    const messageId = outbound.id

    // Step 2: Send the email
    try {
      const { id: providerId } = await this.deps.mailer.sendEmail({
        to: payload.recipientEmail,
        subject: payload.subject,
        html: payload.body,
        recipientName: payload.recipientName,
        ...(payload.replyToken ? { replyTo: `reply+${payload.replyToken}@lunovoria.resend.app` } : {}),
      })

      // Step 3: Mark sent
      await this.deps.db.updateOutboundMessageStatus(messageId, 'sent', { providerId })

      return { messageId, providerId }
    } catch (err) {
      const failedReason = err instanceof Error ? err.message : String(err)

      // Mark failed before rethrowing
      await this.deps.db.updateOutboundMessageStatus(messageId, 'failed', { failedReason })

      throw err
    }
  }
}
