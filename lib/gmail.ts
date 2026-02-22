import { supabaseAdmin } from './supabase'
import { encrypt, decrypt } from './encrypt'

interface SendEmailOptions {
  gymId: string
  to: string
  subject: string
  body: string
  replyToMessageId?: string  // for threading replies (Message-ID header)
  replyToThreadId?: string   // Gmail thread ID
}

async function getAccessToken(gymId: string): Promise<{ token: string; from: string } | null> {
  const { data } = await supabaseAdmin
    .from('gym_gmail')
    .select('access_token, refresh_token, token_expiry, gmail_address')
    .eq('gym_id', gymId)
    .single()

  if (!data) return null

  // Decrypt tokens (handles both encrypted and plaintext for backwards compat)
  let accessToken = data.access_token
  let refreshToken = data.refresh_token

  if (process.env.ENCRYPTION_KEY) {
    try {
      accessToken = decrypt(data.access_token)
    } catch {
      // Already plaintext or wrong format — use as-is
    }
    try {
      refreshToken = decrypt(data.refresh_token)
    } catch {
      // Already plaintext
    }
  }

  // Refresh if expired (or within 60 seconds of expiry)
  const expiry = new Date(data.token_expiry).getTime()
  if (expiry < Date.now() + 60_000) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const refreshed = await res.json()
    if (refreshed.access_token) {
      const newToken = refreshed.access_token
      const storedToken = process.env.ENCRYPTION_KEY ? encrypt(newToken) : newToken

      await supabaseAdmin
        .from('gym_gmail')
        .update({
          access_token: storedToken,
          token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('gym_id', gymId)

      return { token: newToken, from: data.gmail_address }
    }
    return null
  }

  return { token: accessToken, from: data.gmail_address }
}

export async function sendGmailMessage(
  opts: SendEmailOptions
): Promise<{ messageId: string; threadId: string } | null> {
  const auth = await getAccessToken(opts.gymId)
  if (!auth) return null

  // Build RFC 2822 message
  const headers = [
    `From: ${auth.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ]

  // Threading headers
  if (opts.replyToMessageId) {
    headers.push(`In-Reply-To: ${opts.replyToMessageId}`)
    headers.push(`References: ${opts.replyToMessageId}`)
  }

  const message = [...headers, '', opts.body].join('\r\n')
  const encoded = Buffer.from(message).toString('base64url')

  const body: Record<string, string> = { raw: encoded }
  if (opts.replyToThreadId) body.threadId = opts.replyToThreadId

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Gmail send error:', err)
    return null
  }

  const sent = await res.json()
  return { messageId: sent.id, threadId: sent.threadId }
}

export async function isGmailConnected(gymId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('gym_gmail')
    .select('gmail_address')
    .eq('gym_id', gymId)
    .single()
  return data?.gmail_address ?? null
}
