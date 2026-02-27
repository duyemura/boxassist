/**
 * /api/cron/session-monitor — Unified hourly session lifecycle cron.
 *
 * Handles:
 * 1. Expired sessions — close past expires_at
 * 2. Stale active sessions — no turn in 30+ minutes
 * 3. Budget warnings — sessions approaching budget limit
 * 4. Waiting event nudge checks (future: nudge recipients)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const CRON_SECRET = process.env.CRON_SECRET

async function handler(req: NextRequest) {
  // Auth: cron secret
  const authHeader = req.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = {
    expired: 0,
    stale: 0,
    budgetWarnings: 0,
    errors: [] as string[],
  }

  try {
    // 1. Expired sessions — past expires_at
    const { data: expired, error: expiredErr } = await supabaseAdmin
      .from('agent_sessions')
      .update({
        status: 'completed',
        context: supabaseAdmin.rpc ? undefined : undefined, // context stays as-is
        updated_at: new Date().toISOString(),
      })
      .lt('expires_at', new Date().toISOString())
      .in('status', ['active', 'waiting_input', 'waiting_approval', 'waiting_event'])
      .select('id')

    if (expiredErr) {
      results.errors.push(`expired: ${expiredErr.message}`)
    } else {
      results.expired = expired?.length ?? 0
    }

    // 2. Stale active sessions — no turn in 30+ minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data: stale, error: staleErr } = await supabaseAdmin
      .from('agent_sessions')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'active')
      .lt('updated_at', thirtyMinAgo)
      .select('id')

    if (staleErr) {
      results.errors.push(`stale: ${staleErr.message}`)
    } else {
      results.stale = stale?.length ?? 0
    }

    // 3. Budget warnings — active sessions at 80%+ of budget
    const { data: overBudget, error: budgetErr } = await supabaseAdmin
      .from('agent_sessions')
      .select('id, account_id, cost_cents, budget_cents')
      .in('status', ['active', 'waiting_input', 'waiting_approval'])
      .not('budget_cents', 'eq', 0)

    if (budgetErr) {
      results.errors.push(`budget: ${budgetErr.message}`)
    } else if (overBudget) {
      for (const s of overBudget) {
        const sess = s as any
        if (sess.cost_cents >= sess.budget_cents * 0.8) {
          results.budgetWarnings++
          // Could notify owner here in the future
        }
      }
    }
  } catch (err: any) {
    results.errors.push(`unexpected: ${err.message}`)
  }

  const status = results.errors.length > 0 ? 207 : 200
  return NextResponse.json({
    ok: results.errors.length === 0,
    ...results,
    timestamp: new Date().toISOString(),
  }, { status })
}

export const GET = handler
export const POST = handler
