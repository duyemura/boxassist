import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data: gym } = await supabaseAdmin
      .from('gyms')
      .select('id')
      .eq('user_id', session.id)
      .single()

    if (!gym) return NextResponse.json({ events: [] })

    const { data: events } = await supabaseAdmin
      .from('webhook_events')
      .select('*')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(50)

    return NextResponse.json({ events: events ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
