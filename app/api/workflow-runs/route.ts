export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { startWorkflowRun, tickWorkflows } from '@/lib/workflow-runner'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** GET /api/workflow-runs?gymId=xxx&status=active */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const gymId = searchParams.get('gymId')
  const status = searchParams.get('status')

  let query = supabase
    .from('workflow_runs')
    .select('*, workflows(name, goal)')
    .order('updated_at', { ascending: false })
    .limit(50)

  if (gymId) query = query.eq('gym_id', gymId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ runs: data })
}

/** POST /api/workflow-runs — start a new run */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { workflowId, gymId, memberId, memberEmail, memberName, context } = body

  if (!workflowId || !gymId || !memberEmail) {
    return NextResponse.json({ error: 'workflowId, gymId, memberEmail required' }, { status: 400 })
  }

  try {
    const run = await startWorkflowRun({
      workflowId,
      gymId,
      memberId: memberId ?? memberEmail,
      memberEmail,
      memberName: memberName ?? memberEmail.split('@')[0],
      initialContext: context ?? {},
    })
    return NextResponse.json({ run })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
