export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser(session.id)

  if (!account) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('gym_instagram')
    .delete()
    .eq('account_id', account.id)

  if (error) {
    console.error('Instagram disconnect error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ disconnected: true })
}
