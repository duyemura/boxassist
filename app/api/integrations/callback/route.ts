export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/callback
 *
 * Composio redirects here after a successful OAuth connection.
 * Query params from Composio: connectedAccountId, status (and our custom: integrationId, accountId)
 *
 * Updates our DB record, then redirects to the dashboard integrations section.
 */

import { NextRequest, NextResponse } from 'next/server'
import { upsertIntegration } from '@/lib/db/integrations'
import { listConnections } from '@/lib/integrations/composio'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const integrationId = searchParams.get('integrationId') ?? ''
  const accountId = searchParams.get('accountId') ?? ''

  // Composio passes these in the redirect
  const connectedAccountId =
    searchParams.get('connectedAccountId') ??
    searchParams.get('connected_account_id') ??
    ''
  const status = searchParams.get('status') ?? ''

  const origin = req.nextUrl.origin

  // Failure path
  if (status === 'failed' || status === 'error') {
    return NextResponse.redirect(
      `${origin}/dashboard?section=integrations&error=${encodeURIComponent('Connection failed. Please try again.')}`,
    )
  }

  if (!accountId || !integrationId) {
    return NextResponse.redirect(`${origin}/dashboard?section=integrations`)
  }

  try {
    // Get extra metadata from Composio (workspace name, email, etc.)
    let metadata: Record<string, unknown> = {}
    try {
      const connections = await listConnections(accountId)
      const conn = connections.find(c => c.integrationId === integrationId)
      if (conn) {
        metadata = { status: conn.status }
      }
    } catch {
      // Non-fatal — metadata enrichment is best-effort
    }

    // Update our DB record with the real connectedAccountId
    if (connectedAccountId) {
      await upsertIntegration(accountId, integrationId, connectedAccountId, metadata)
    }

    return NextResponse.redirect(
      `${origin}/dashboard?section=integrations&connected=${encodeURIComponent(integrationId)}`,
    )
  } catch (err: any) {
    console.error('Integration callback error:', err)
    return NextResponse.redirect(
      `${origin}/dashboard?section=integrations&error=${encodeURIComponent('Failed to save connection.')}`,
    )
  }
}
