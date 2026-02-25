import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getMonthlyRetentionROI } from '@/lib/db/kpi'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Demo session: return sample scorecard
  if ((session as any).isDemo) {
    return NextResponse.json({
      tasksCreated: 12,
      messagesSent: 18,
      membersRetained: 7,
      revenueRetained: 1050,
      membersChurned: 2,
      conversationsActive: 3,
      escalations: 1,
    })
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const month = req.nextUrl.searchParams.get('month') ?? undefined
  const scorecard = await getMonthlyRetentionROI(gym.id, month)

  return NextResponse.json(scorecard)
}
