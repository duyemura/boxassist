export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) return NextResponse.json({ connected: false, email: null })

  const { data: gmailRecord } = await supabaseAdmin
    .from('gym_gmail')
    .select('gmail_address')
    .eq('gym_id', gym.id)
    .single()

  return NextResponse.json({
    connected: !!gmailRecord,
    email: gmailRecord?.gmail_address ?? null,
  })
}
