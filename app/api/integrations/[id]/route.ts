export const dynamic = 'force-dynamic'

/**
 * DELETE /api/integrations/[id]
 *
 * Disconnects an integration: deletes from Composio + removes our DB record.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { deleteIntegration } from '@/lib/db/integrations'
import { deleteConnection } from '@/lib/integrations/composio'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 404 })

  try {
    // Remove from our DB and get the Composio account ID to revoke
    const composioAccountId = await deleteIntegration(account.id, params.id)

    // Revoke from Composio (best-effort — don't fail if Composio is down)
    if (composioAccountId) {
      await deleteConnection(composioAccountId)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error(`Integration disconnect error [${params.id}]:`, err)
    return NextResponse.json({ error: err.message ?? 'Disconnect failed' }, { status: 500 })
  }
}
