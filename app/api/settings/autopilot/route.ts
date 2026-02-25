import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ autopilotEnabled: false, shadowModeUntil: null })
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('autopilot_enabled, autopilot_enabled_at')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  // Shadow mode: first 7 days after enabling
  let shadowModeUntil: string | null = null
  if (gym.autopilot_enabled && gym.autopilot_enabled_at) {
    const enabledAt = new Date(gym.autopilot_enabled_at)
    const shadowEnd = new Date(enabledAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    if (shadowEnd > new Date()) {
      shadowModeUntil = shadowEnd.toISOString()
    }
  }

  return NextResponse.json({
    autopilotEnabled: gym.autopilot_enabled ?? false,
    shadowModeUntil,
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })
  }

  const { enabled } = await req.json()

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id, autopilot_enabled')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {
    autopilot_enabled: !!enabled,
  }

  // Set enabled_at only when turning on (for shadow mode calculation)
  if (enabled && !gym.autopilot_enabled) {
    updates.autopilot_enabled_at = new Date().toISOString()
  }

  await supabaseAdmin
    .from('gyms')
    .update(updates)
    .eq('id', gym.id)

  return NextResponse.json({ success: true, autopilotEnabled: !!enabled })
}
