export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser(session.id)

  if (!account) return NextResponse.json({ connected: false, email: null })

  const { data: gmailRecord } = await supabaseAdmin
    .from('account_gmail')
    .select('gmail_address')
    .eq('account_id', account.id)
    .single()

  return NextResponse.json({
    connected: !!gmailRecord,
    email: gmailRecord?.gmail_address ?? null,
  })
}
