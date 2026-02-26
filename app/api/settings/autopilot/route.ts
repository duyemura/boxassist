export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({
      autopilotEnabled: false,
      autopilotLevel: 'draft_only',
      shadowModeUntil: null,
      shadowModeActive: false,
    })
  }

  const account = await getAccountForUser(session.id)

  if (!account) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  // Shadow mode: first 7 days after enabling smart or full_auto
  let shadowModeUntil: string | null = null
  let shadowModeActive = false
  const level = (account.autopilot_level as string | null) ?? 'draft_only'
  if (account.autopilot_enabled && account.autopilot_enabled_at && level !== 'draft_only') {
    const enabledAt = new Date(account.autopilot_enabled_at as string)
    const shadowEnd = new Date(enabledAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    if (shadowEnd > new Date()) {
      shadowModeUntil = shadowEnd.toISOString()
      shadowModeActive = true
    }
  }

  return NextResponse.json({
    autopilotEnabled: (account.autopilot_enabled as boolean) ?? false,
    autopilotLevel: level,
    shadowModeUntil,
    shadowModeActive,
  })
}

const VALID_LEVELS = ['draft_only', 'smart', 'full_auto'] as const
type AutopilotLevel = (typeof VALID_LEVELS)[number]

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })
  }

  const body = await req.json()
  const level = body.level as string | undefined
  const enabled = body.enabled as boolean | undefined

  const account = await getAccountForUser(session.id)

  if (!account) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  // Handle level change
  if (level && VALID_LEVELS.includes(level as AutopilotLevel)) {
    updates.autopilot_level = level
    // draft_only means autopilot is effectively off; anything else means on
    updates.autopilot_enabled = level !== 'draft_only'

    // Reset shadow mode timer when upgrading to smart/full_auto
    if (level !== 'draft_only' && (!account.autopilot_enabled || account.autopilot_level === 'draft_only')) {
      updates.autopilot_enabled_at = new Date().toISOString()
    }
  }

  // Handle simple toggle (backwards compat)
  if (typeof enabled === 'boolean' && !level) {
    updates.autopilot_enabled = enabled
    if (enabled && !account.autopilot_enabled) {
      updates.autopilot_enabled_at = new Date().toISOString()
    }
    if (!enabled) {
      updates.autopilot_level = 'draft_only'
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin
      .from('accounts')
      .update(updates)
      .eq('id', account.id)
  }

  return NextResponse.json({
    success: true,
    autopilotEnabled: (updates.autopilot_enabled ?? account.autopilot_enabled) as boolean,
    autopilotLevel: (updates.autopilot_level ?? account.autopilot_level ?? 'draft_only') as string,
  })
}
