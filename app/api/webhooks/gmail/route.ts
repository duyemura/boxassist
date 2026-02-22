import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Pub/Sub message is base64-encoded
  const data = body.message?.data
  if (!data) return NextResponse.json({ ok: true })

  let decoded: { emailAddress?: string; historyId?: string }
  try {
    decoded = JSON.parse(Buffer.from(data, 'base64').toString())
  } catch {
    console.error('Gmail webhook: failed to decode Pub/Sub message')
    return NextResponse.json({ ok: true })
  }

  const { emailAddress, historyId } = decoded
  if (!emailAddress || !historyId) return NextResponse.json({ ok: true })

  // Find gym by gmail address
  const { data: gmailRecord } = await supabaseAdmin
    .from('gym_gmail')
    .select('gym_id, access_token, refresh_token, token_expiry, pubsub_history_id, gmail_address')
    .eq('gmail_address', emailAddress)
    .single()

  if (!gmailRecord) return NextResponse.json({ ok: true })

  // TODO: fetch new messages since last historyId using Gmail History API,
  // find replies to agent threads, and store them as agent_email_messages (inbound).
  // Requires GCP project ID + Pub/Sub topic to be set up.

  // Update pubsub_history_id so we only fetch new messages next time
  await supabaseAdmin
    .from('gym_gmail')
    .update({
      pubsub_history_id: historyId,
      updated_at: new Date().toISOString(),
    })
    .eq('gym_id', gmailRecord.gym_id)

  console.log(`Gmail push: ${emailAddress}, historyId: ${historyId}`)

  return NextResponse.json({ ok: true })
}
