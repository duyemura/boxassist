export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getMonthlyRetentionROI } from '@/lib/db/kpi'
import { getAccountForUser } from '@/lib/db/accounts'

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

  const account = await getAccountForUser(session.id)

  if (!account) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const month = req.nextUrl.searchParams.get('month') ?? undefined
  const scorecard = await getMonthlyRetentionROI(account.id, month)

  return NextResponse.json(scorecard)
}
