export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { updateTaskStatus } from '@/lib/db/tasks'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { actionId } = await req.json()

    await updateTaskStatus(actionId, 'cancelled', {
      outcome: 'not_applicable',
      outcomeReason: 'Dismissed by owner',
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
