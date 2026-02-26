export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { encrypt } from '@/lib/encrypt'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const userId = req.nextUrl.searchParams.get('state')

  if (!code || !userId) {
    return NextResponse.redirect(new URL('/settings?error=gmail_auth_failed', req.url))
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()
  if (!tokens.access_token) {
    console.error('Gmail token exchange failed:', tokens)
    return NextResponse.redirect(new URL('/settings?error=gmail_token_failed', req.url))
  }

  // Get their Gmail address
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = await profileRes.json()

  if (!profile.email) {
    return NextResponse.redirect(new URL('/settings?error=gmail_profile_failed', req.url))
  }

  // Get gym for this user
  const account = await getAccountForUser(userId)

  if (!account) {
    return NextResponse.redirect(new URL('/settings?error=no_gym', req.url))
  }

  // Encrypt tokens before storing
  const encryptedAccessToken = process.env.ENCRYPTION_KEY
    ? encrypt(tokens.access_token)
    : tokens.access_token
  const encryptedRefreshToken = tokens.refresh_token && process.env.ENCRYPTION_KEY
    ? encrypt(tokens.refresh_token)
    : (tokens.refresh_token ?? '')

  await supabaseAdmin
    .from('account_gmail')
    .upsert(
      {
        account_id: account.id,
        gmail_address: profile.email,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    )

  return NextResponse.redirect(new URL('/settings?connected=gmail', req.url))
}
