/**
 * CommandBus — issue and process commands with retry and dead-lettering.
 *
 * Exponential backoff schedule:
 *   attempt 0 (first failure) → +2 minutes
 *   attempt 1                 → +10 minutes
 *   attempt 2+ (>= maxAttempts-1) → dead-letter
 */

export type CommandType = 'SendEmail' | 'SendSMS' | 'CreateTask' | 'CloseTask' | 'EscalateTask'
export type CommandStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead'

export interface AgentCommand {
  id: string
  gymId: string
  commandType: CommandType
  payload: Record<string, unknown>
  issuedByAgent: string
  taskId?: string
  status: CommandStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  lastError?: string
  result?: Record<string, unknown>
  createdAt: string
  completedAt?: string
}

export interface CommandBusDeps {
  db: {
    insertCommand: (cmd: Omit<AgentCommand, 'id' | 'createdAt'>) => Promise<AgentCommand>
    claimPendingCommands: (limit: number) => Promise<AgentCommand[]>
    completeCommand: (id: string, result: Record<string, unknown>) => Promise<void>
    failCommand: (id: string, error: string, nextAttemptAt: Date) => Promise<void>
    deadLetterCommand: (id: string, error: string) => Promise<void>
  }
  executors: Partial<Record<CommandType, CommandExecutor>>
}

export interface CommandExecutor {
  execute(command: AgentCommand): Promise<Record<string, unknown>>
}

// Backoff schedule in minutes indexed by attempt count (0-based)
const BACKOFF_MINUTES = [2, 10]

export class CommandBus {
  constructor(private deps: CommandBusDeps) {}

  /**
   * Issue a new command — inserts into DB with pending status.
   * Returns the command ID.
   */
  async issue(
    commandType: CommandType,
    payload: Record<string, unknown>,
    opts?: {
      gymId: string
      issuedByAgent: string
      taskId?: string
      maxAttempts?: number
    },
  ): Promise<string> {
    const cmd = await this.deps.db.insertCommand({
      gymId: opts?.gymId ?? '',
      commandType,
      payload,
      issuedByAgent: opts?.issuedByAgent ?? 'unknown',
      taskId: opts?.taskId,
      status: 'pending',
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      nextAttemptAt: new Date().toISOString(),
    })

    return cmd.id
  }

  /**
   * Process up to `limit` pending commands.
   * Returns counts of processed (succeeded) and failed.
   */
  async processNext(limit = 10): Promise<{ processed: number; failed: number }> {
    const commands = await this.deps.db.claimPendingCommands(limit)

    let processed = 0
    let failed = 0

    for (const command of commands) {
      try {
        const executor = this.deps.executors[command.commandType]

        // No executor registered → dead-letter immediately
        if (!executor) {
          await this.deps.db.deadLetterCommand(
            command.id,
            `No executor registered for command type: ${command.commandType}`,
          )
          failed++
          continue
        }

        const result = await executor.execute(command)
        await this.deps.db.completeCommand(command.id, result)
        processed++
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const nextAttempt = command.attempts + 1

        // If this failure exhausts our retry budget → dead-letter
        if (nextAttempt >= command.maxAttempts) {
          await this.deps.db.deadLetterCommand(command.id, errorMsg)
        } else {
          // Calculate backoff delay
          const backoffMin = BACKOFF_MINUTES[command.attempts] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]
          const nextAttemptAt = new Date(Date.now() + backoffMin * 60 * 1000)
          await this.deps.db.failCommand(command.id, errorMsg, nextAttemptAt)
        }
        failed++
      }
    }

    return { processed, failed }
  }
}
