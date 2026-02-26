export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { tickWorkflows } from '@/lib/workflow-runner'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await tickWorkflows()
    return NextResponse.json({ ok: true, tickedAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
