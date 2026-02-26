export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

const JWT_SECRET = process.env.JWT_SECRET!

export async function POST(req: NextRequest) {
  // Accept optional visitor details from the demo gate form
  let visitorName = ''
  let visitorEmail = ''
  try {
    const body = await req.json()
    visitorName = (body?.name ?? '').trim()
    visitorEmail = (body?.email ?? '').trim()
  } catch {
    // Body might be empty, that's fine
  }

  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

  // Seed a real "At-Risk Monitor" agent row scoped to this session
  try {
    await supabaseAdmin.from('agents').insert({
      id: crypto.randomUUID(),
      account_id: null,
      user_id: `demo-${sessionId}`,
      demo_session_id: sessionId,
      expires_at: expiresAt,
      name: 'At-Risk Monitor',
      description: "Scans your members daily. Finds who's drifting, drafts a personal message, asks if you want to send it.",
      skill_type: 'at_risk_detector',
      trigger_mode: 'cron',
      cron_schedule: 'daily',
      is_active: true,
      system_prompt: 'You are a gym retention assistant. Find members who have not checked in recently and are at risk of churning. Draft personal, warm messages from the gym owner.',
      action_type: 'draft_message',
      estimated_value: 'Keeps members from quietly cancelling.',
      run_count: 0,
      approval_rate: 0,
    })
  } catch (err) {
    console.error('Demo agent seed error:', err)
  }

  // Build JWT payload — include visitor details when provided
  const jwtPayload: Record<string, any> = {
    userId: `demo-${sessionId}`,
    email: 'demo@gymagents.com',
    accountName: 'PushPress East',
    companyId: process.env.PUSHPRESS_COMPANY_ID,
    apiKey: process.env.PUSHPRESS_API_KEY,
    isDemo: true,
    demoSessionId: sessionId,
    tier: 'pro',
  }

  if (visitorName) jwtPayload.demoVisitorName = visitorName
  if (visitorEmail) jwtPayload.demoVisitorEmail = visitorEmail

  const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '2h' })

  const response = NextResponse.json({ success: true })
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 2,
    path: '/',
  })
  return response
}
