export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { tickWorkflows } from '@/lib/workflow-runner'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await tickWorkflows()
    return NextResponse.json({ ok: true, tickedAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
