export const dynamic = 'force-dynamic'

/**
 * POST /api/integrations/[id]/connect
 *
 * Two flows depending on integration type:
 *
 * OAuth: returns { redirectUrl } — frontend redirects the user there.
 * API key: accepts { credentials } — stores in Composio directly, returns { ok }.
 *
 * The [id] param is the Composio toolkit slug (e.g. 'slack', 'gmail', 'twilio').
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { getIntegration as getIntegrationDef } from '@/lib/integrations/registry'
import { initiateOAuthConnection, initiateApiKeyConnection } from '@/lib/integrations/composio'
import { upsertIntegration } from '@/lib/db/integrations'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 404 })

  const integrationDef = getIntegrationDef(params.id)
  if (!integrationDef) {
    return NextResponse.json({ error: 'Unknown integration' }, { status: 404 })
  }

  try {
    if (integrationDef.authType === 'oauth') {
      // Build callback URL pointing back to our app
      const origin = req.headers.get('origin') ?? req.nextUrl.origin
      const callbackUrl = `${origin}/api/integrations/callback?integrationId=${params.id}&accountId=${account.id}`

      const { redirectUrl, connectedAccountId } = await initiateOAuthConnection(
        account.id,
        params.id,
        callbackUrl,
      )

      // Pre-create a pending record so we can match on callback
      if (connectedAccountId) {
        await upsertIntegration(account.id, params.id, connectedAccountId, {})
      }

      return NextResponse.json({ redirectUrl })
    }

    if (integrationDef.authType === 'api_key') {
      const body = await req.json()
      const { credentials } = body as { credentials: Record<string, string> }

      if (!credentials || typeof credentials !== 'object') {
        return NextResponse.json({ error: 'credentials required' }, { status: 400 })
      }

      // Separate from_number (stored in our DB) from Composio credentials
      const { from_number, ...composioCredentials } = credentials

      const composioAccountId = await initiateApiKeyConnection(
        account.id,
        params.id,
        composioCredentials,
      )

      // Store in our DB with metadata
      const metadata: Record<string, unknown> = {}
      if (from_number) metadata.from_number = from_number

      await upsertIntegration(account.id, params.id, composioAccountId, metadata)

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unsupported auth type' }, { status: 400 })
  } catch (err: any) {
    console.error(`Integration connect error [${params.id}]:`, err)
    return NextResponse.json({ error: err.message ?? 'Connection failed' }, { status: 500 })
  }
}
