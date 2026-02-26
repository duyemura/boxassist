export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { getAccountForUser } from '@/lib/db/accounts'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imageUrl, caption } = await req.json()

  if (!imageUrl || !caption) {
    return NextResponse.json({ error: 'imageUrl and caption are required' }, { status: 400 })
  }

  // Look up the gym
  const account = await getAccountForUser(session.id)

  if (!account) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  // Fetch Instagram credentials
  const { data: record } = await supabaseAdmin
    .from('gym_instagram')
    .select('access_token, instagram_business_account_id')
    .eq('account_id', account.id)
    .single()

  if (!record) {
    return NextResponse.json({ error: 'Instagram not connected' }, { status: 400 })
  }

  // Decrypt the token
  let accessToken = record.access_token
  if (process.env.ENCRYPTION_KEY) {
    try {
      accessToken = decrypt(record.access_token)
    } catch {
      // Already plaintext or wrong format — use as-is
    }
  }

  const accountId = record.instagram_business_account_id

  // Step 1: Create media container
  const createMediaRes = await fetch(
    `https://graph.facebook.com/v21.0/${accountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    }
  )

  if (!createMediaRes.ok) {
    const err = await createMediaRes.json()
    console.error('Instagram media creation error:', err)
    return NextResponse.json(
      { error: err?.error?.message ?? 'Failed to create media container' },
      { status: 400 }
    )
  }

  const { id: creationId } = await createMediaRes.json()

  // Step 2: Publish the media container
  const publishRes = await fetch(
    `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    }
  )

  if (!publishRes.ok) {
    const err = await publishRes.json()
    console.error('Instagram publish error:', err)
    return NextResponse.json(
      { error: err?.error?.message ?? 'Failed to publish media' },
      { status: 400 }
    )
  }

  const { id: mediaId } = await publishRes.json()

  // Fetch permalink
  let permalink: string | null = null
  try {
    const permalinkRes = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`
    )
    if (permalinkRes.ok) {
      const data = await permalinkRes.json()
      permalink = data.permalink ?? null
    }
  } catch {
    // Permalink is optional — don't fail on it
  }

  return NextResponse.json({ published: true, mediaId, permalink })
}
