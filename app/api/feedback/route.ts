export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'

const VALID_TYPES = ['feedback', 'bug', 'error', 'suggestion'] as const

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, message, url, metadata } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    if (type && !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    // Auth is optional — capture feedback even from unauthenticated contexts
    let accountId: string | null = null
    let userId: string | null = null
    try {
      const session = await getSession()
      if (session) {
        userId = session.id ?? null
        // Try to get account_id from session if available
        accountId = (session as any).accountId ?? null
      }
    } catch {
      // Ignore auth errors — feedback capture should never fail due to auth
    }

    const { data, error } = await supabaseAdmin.from('feedback').insert({
      account_id: accountId,
      user_id: userId,
      type: type || 'feedback',
      message: message.trim().slice(0, 5000),
      url: url ? String(url).slice(0, 2000) : null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      status: 'new',
    }).select().single()

    if (error) {
      console.error('[feedback] Insert error:', error)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
  } catch (err) {
    console.error('[feedback] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'new'
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[feedback] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 })
    }

    return NextResponse.json({ feedback: data || [] })
  } catch (err) {
    console.error('[feedback] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
