export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { skillType, isActive } = await req.json()

  const account = await getAccountForUser(session.id)
  
  if (!account) return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  
  await supabaseAdmin
    .from('agents')
    .update({ is_active: isActive })
    .eq('account_id', account.id)
    .eq('skill_type', skillType)
  
  return NextResponse.json({ success: true })
}
