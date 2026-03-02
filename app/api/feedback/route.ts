export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { findOrCreateFeedbackIssue } from '@/lib/linear'
import { generateErrorFingerprint } from '@/lib/bug-triage'

const VALID_TYPES = ['feedback', 'bug', 'error', 'suggestion'] as const
const BUCKET = 'feedback-screenshots'
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024 // 2MB

/** Ensure the storage bucket exists (idempotent) */
async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET)
  if (!data) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true })
  }
}

/** Upload base64 screenshot to Supabase Storage, return public URL */
async function uploadScreenshot(feedbackId: string, base64Data: string): Promise<string | null> {
  try {
    // Strip data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')

    if (buffer.length > MAX_SCREENSHOT_BYTES) return null

    await ensureBucket()

    const path = `${feedbackId}.png`
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (error) {
      console.error('[feedback] Screenshot upload error:', error)
      return null
    }

    const { data: urlData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(path)

    return urlData?.publicUrl ?? null
  } catch (err) {
    console.error('[feedback] Screenshot upload failed:', err)
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, message, url, metadata, screenshot } = body

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

    // Generate a temp ID for the screenshot filename
    const tempId = crypto.randomUUID()

    // Upload screenshot if provided (async, non-blocking on feedback insert)
    let screenshotUrl: string | null = null
    if (screenshot && typeof screenshot === 'string') {
      screenshotUrl = await uploadScreenshot(tempId, screenshot)
    }

    const enrichedMetadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...(screenshotUrl ? { screenshot_url: screenshotUrl } : {}),
    }

    // Generate fingerprint for error/bug types (enables dedup)
    const feedbackType = type || 'feedback'
    const isErrorType = feedbackType === 'error' || feedbackType === 'bug'
    const fingerprint = isErrorType
      ? await generateErrorFingerprint(
          message.trim(),
          metadata?.stack ?? null,
        )
      : null

    const { data, error } = await supabaseAdmin.from('feedback').insert({
      account_id: accountId,
      user_id: userId,
      type: feedbackType,
      message: message.trim().slice(0, 5000),
      url: url ? String(url).slice(0, 2000) : null,
      metadata: enrichedMetadata,
      error_fingerprint: fingerprint,
      status: 'new',
    }).select().single()

    if (error) {
      console.error('[feedback] Insert error:', error)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // Auto-create Linear issue (fire-and-forget, non-blocking)
    // Uses dedup: same error fingerprint → comment on existing ticket instead of creating new one
    findOrCreateFeedbackIssue({
      type: feedbackType,
      message: message.trim(),
      url,
      screenshotUrl,
      metadata: enrichedMetadata,
      feedbackId: data.id,
    }, fingerprint).then(issue => {
      if (issue) {
        // Store the Linear issue link back on the feedback row
        supabaseAdmin.from('feedback').update({
          metadata: {
            ...enrichedMetadata,
            linear_issue: issue.identifier,
            linear_issue_id: issue.id,
            linear_url: issue.url,
          },
        }).eq('id', data.id).then(() => {})
      }
    }).catch(err => {
      console.error('[feedback] Linear issue creation failed:', err)
    })

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
