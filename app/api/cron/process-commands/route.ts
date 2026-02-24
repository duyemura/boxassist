/**
 * Vercel Cron endpoint — processes pending agent commands.
 *
 * Called every 60 seconds by Vercel Cron.
 * Validates CRON_SECRET header before processing.
 *
 * vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/process-commands", "schedule": "* * * * *" }]
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { CommandBus } from '@/lib/commands/commandBus'
import * as dbCommands from '@/lib/db/commands'
import { SendEmailExecutor } from '@/lib/commands/executors/sendEmailExecutor'
import { sendEmail } from '@/lib/resend'

async function handler(req: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET — Vercel sends Authorization: Bearer <CRON_SECRET> on GET
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Wire up real executor
    const sendEmailExecutor = new SendEmailExecutor({
      mailer: { sendEmail },
      db: {
        createOutboundMessage: dbCommands.createOutboundMessage,
        updateOutboundMessageStatus: dbCommands.updateOutboundMessageStatus,
      },
    })

    const bus = new CommandBus({
      db: {
        insertCommand: dbCommands.insertCommand,
        claimPendingCommands: dbCommands.claimPendingCommands,
        completeCommand: dbCommands.completeCommand,
        failCommand: dbCommands.failCommand,
        deadLetterCommand: dbCommands.deadLetterCommand,
      },
      executors: {
        SendEmail: sendEmailExecutor,
      },
    })

    const result = await bus.processNext(20)

    return NextResponse.json({ ...result, ok: true })
  } catch (err: any) {
    console.error('process-commands cron error:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'internal error' }, { status: 500 })
  }
}

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
