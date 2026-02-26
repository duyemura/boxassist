export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { skillType, isActive } = await req.json()
  
  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()
  
  if (!gym) return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  
  await supabaseAdmin
    .from('autopilots')
    .update({ is_active: isActive })
    .eq('gym_id', gym.id)
    .eq('skill_type', skillType)
  
  return NextResponse.json({ success: true })
}
