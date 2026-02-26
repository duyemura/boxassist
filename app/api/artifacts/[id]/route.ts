export const dynamic = 'force-dynamic'

/**
 * GET /api/artifacts/[id] — serve a rendered artifact
 *
 * Query params:
 *   ?format=html   — return raw HTML (for iframe embed or standalone view)
 *   ?format=json   — return artifact JSON (default)
 *   ?token=xxx     — public share token (no auth required)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getArtifact, getArtifactByShareToken } from '@/lib/artifacts/db'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const format = req.nextUrl.searchParams.get('format') ?? 'json'
  const shareToken = req.nextUrl.searchParams.get('token')

  let artifact

  // Public access via share token
  if (shareToken) {
    artifact = await getArtifactByShareToken(shareToken)
    if (!artifact || artifact.id !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } else {
    // Authenticated access
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    artifact = await getArtifact(id)
    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Verify gym ownership
    const account = await getAccountForUser(session.id)

    if (!account || account.id !== artifact.account_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Return raw HTML for iframe/standalone viewing
  if (format === 'html') {
    return new NextResponse(artifact.html ?? '<p>No content</p>', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  // Return JSON (without full HTML to keep payload small)
  return NextResponse.json({
    artifact: {
      id: artifact.id,
      artifact_type: artifact.artifact_type,
      title: artifact.title,
      data: artifact.data,
      task_id: artifact.task_id,
      created_by: artifact.created_by,
      share_token: artifact.share_token,
      created_at: artifact.created_at,
    },
  })
}
