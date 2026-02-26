export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { encrypt } from '@/lib/encrypt'
import { getAccountForUser } from '@/lib/db/accounts'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accessToken, businessAccountId } = await req.json()

  if (!accessToken || !businessAccountId) {
    return NextResponse.json({ error: 'accessToken and businessAccountId are required' }, { status: 400 })
  }

  // Look up the gym for this user
  const account = await getAccountForUser(session.id)

  if (!account) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  // Validate the access token against the Facebook Graph API
  const validateRes = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=name&access_token=${encodeURIComponent(accessToken)}`
  )
  if (!validateRes.ok) {
    const err = await validateRes.json()
    return NextResponse.json(
      { error: err?.error?.message ?? 'Invalid access token' },
      { status: 400 }
    )
  }

  // Fetch Instagram username from the Business Account
  const igRes = await fetch(
    `https://graph.facebook.com/v21.0/${businessAccountId}?fields=username&access_token=${encodeURIComponent(accessToken)}`
  )
  if (!igRes.ok) {
    const err = await igRes.json()
    return NextResponse.json(
      { error: err?.error?.message ?? 'Could not fetch Instagram account' },
      { status: 400 }
    )
  }
  const igData = await igRes.json()
  const username: string = igData.username ?? ''

  // Encrypt the token before storing
  const encryptedToken = process.env.ENCRYPTION_KEY ? encrypt(accessToken) : accessToken

  const now = new Date().toISOString()

  const { error: upsertError } = await supabaseAdmin
    .from('gym_instagram')
    .upsert(
      {
        account_id: account.id,
        access_token: encryptedToken,
        instagram_business_account_id: businessAccountId,
        instagram_username: username,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'account_id' }
    )

  if (upsertError) {
    console.error('Instagram upsert error:', upsertError)
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ connected: true, username })
}
