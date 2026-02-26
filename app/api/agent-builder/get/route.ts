export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const isDemo = (session as any)?.isDemo
  const demoSessionId = (session as any)?.demoSessionId

  let query = supabase.from('autopilots').select('*').eq('id', id)

  if (isDemo && demoSessionId) {
    // Scope demo fetch to this session only
    query = query.eq('demo_session_id', demoSessionId)
  } else {
    query = query.eq('user_id', session.id)
  }

  const { data, error } = await query.single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Map DB row back to AutopilotConfig shape
  const config = {
    name: data.name,
    description: data.description || '',
    trigger_mode: data.trigger_mode,
    trigger_event: data.trigger_event,
    cron_schedule: data.cron_schedule,
    data_sources: data.data_sources || [],
    action_type: data.action_type || 'draft_message',
    system_prompt: data.system_prompt || '',
    estimated_value: data.estimated_value || '',
    skill_type: data.skill_type,
  }

  return NextResponse.json({ config })
}
