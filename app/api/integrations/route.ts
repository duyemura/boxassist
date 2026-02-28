export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations
 * Returns all connected integrations for the authenticated account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { getIntegrations } from '@/lib/db/integrations'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ integrations: [] })

  const integrations = await getIntegrations(account.id)

  return NextResponse.json({
    integrations: integrations.map(i => ({
      integrationId: i.integrationId,
      connectedAt: i.connectedAt,
      metadata: i.metadata,
    })),
  })
}
