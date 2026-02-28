/**
 * Composio client — singleton + helper functions.
 *
 * This is the ONLY file that imports or calls Composio.
 * Everything else goes through these helpers.
 *
 * Composio stores OAuth tokens and API keys.
 * We store: (a) which integrations are connected per account, (b) extra metadata
 * like Twilio's from_number that Composio doesn't need.
 */

import { Composio, AuthScheme } from '@composio/core'
import type { AgentTool, ToolContext } from '../agents/tools/types'

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: Composio | null = null

export function getComposio(): Composio {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY
    if (!apiKey) throw new Error('COMPOSIO_API_KEY is not set')
    _client = new Composio({ apiKey, allowTracking: false })
  }
  return _client
}

// ── Auth config ID cache ──────────────────────────────────────────────────────
// Composio-managed auth configs are static — look up once and cache in memory.

const authConfigCache = new Map<string, string>() // toolkit → authConfigId

export async function getAuthConfigId(toolkit: string): Promise<string> {
  if (authConfigCache.has(toolkit)) return authConfigCache.get(toolkit)!

  const composio = getComposio()
  const configs = await composio.authConfigs.list({
    toolkit,
    isComposioManaged: true,
  } as any)

  const items = (configs as any).items ?? (configs as any).data ?? []
  const config = items[0]
  if (!config?.id) throw new Error(`No Composio-managed auth config found for toolkit: ${toolkit}`)

  authConfigCache.set(toolkit, config.id)
  return config.id
}

// ── Connection management ─────────────────────────────────────────────────────

/**
 * Initiate an OAuth connection for a toolkit.
 * Returns the redirect URL to send the user to.
 */
export async function initiateOAuthConnection(
  accountId: string,
  toolkit: string,
  callbackUrl: string,
): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const composio = getComposio()
  const authConfigId = await getAuthConfigId(toolkit)

  const request = await composio.connectedAccounts.link(accountId, authConfigId, {
    callbackUrl,
  })

  if (!request.redirectUrl) {
    throw new Error(`No redirect URL returned for toolkit: ${toolkit}`)
  }

  return {
    redirectUrl: request.redirectUrl,
    connectedAccountId: request.connectedAccountId ?? (request as any).id ?? '',
  }
}

/**
 * Store an API key connection for a toolkit (no redirect — inline form).
 * For Basic auth toolkits (Twilio): pass { username, password }.
 * For API key toolkits: pass { api_key }.
 * Returns the Composio connectedAccountId.
 */
export async function initiateApiKeyConnection(
  accountId: string,
  toolkit: string,
  credentials: Record<string, string>,
): Promise<string> {
  const composio = getComposio()
  const authConfigId = await getAuthConfigId(toolkit)

  // Build the auth scheme based on what fields were provided
  let connectionData
  if ('username' in credentials && 'password' in credentials) {
    connectionData = AuthScheme.Basic({
      username: credentials.username,
      password: credentials.password,
    })
  } else if ('api_key' in credentials) {
    connectionData = AuthScheme.APIKey({ api_key: credentials.api_key })
  } else {
    // Generic: try API key with the first value
    const firstValue = Object.values(credentials)[0]
    connectionData = AuthScheme.APIKey({ api_key: firstValue })
  }

  const request = await composio.connectedAccounts.initiate(accountId, authConfigId, {
    config: connectionData,
  })

  return request.connectedAccountId ?? (request as any).id ?? ''
}

/**
 * Delete a connected account in Composio.
 */
export async function deleteConnection(composioAccountId: string): Promise<void> {
  const composio = getComposio()
  try {
    await composio.connectedAccounts.delete(composioAccountId)
  } catch (err: any) {
    // Log but don't throw — we still want to clear our local record
    console.error(`Failed to delete Composio connection ${composioAccountId}:`, err.message)
  }
}

/**
 * List all connected integrations for an account from Composio.
 * Returns an array of { integrationId, composioAccountId, metadata }.
 */
export async function listConnections(
  accountId: string,
): Promise<Array<{ integrationId: string; composioAccountId: string; status: string }>> {
  const composio = getComposio()

  const result = await composio.connectedAccounts.list({ userIds: [accountId] })
  const items = (result as any).items ?? (result as any).data ?? []

  return items.map((item: any) => ({
    integrationId: item.toolkit?.slug ?? item.appName ?? item.app ?? '',
    composioAccountId: item.id ?? item.nanoid ?? '',
    status: item.status ?? 'UNKNOWN',
  }))
}

// ── Tool injection ────────────────────────────────────────────────────────────

const ALWAYS_APPROVE_TOOLS = [
  'GMAIL_SEND_EMAIL',
  'GMAIL_REPLY_TO_THREAD',
  'SLACK_SENDS_A_MESSAGE',
  'SLACK_CREATE_A_NEW_CHANNEL_IN_WORKSPACE',
  'TWILIO_SEND_SMS',
  'TWILIO_SEND_MESSAGE',
]

function requiresApproval(toolName: string): boolean {
  return ALWAYS_APPROVE_TOOLS.some(t => toolName.toUpperCase().includes(t.split('_').slice(-2).join('_')))
}

/**
 * Get all tools available to an account via Composio.
 * Called at session start — returns AgentTool[] compatible with our registry interface.
 * Only returns tools for integrations the account has actually connected.
 */
export async function getComposioToolsForAccount(accountId: string): Promise<AgentTool[]> {
  try {
    const composio = getComposio()

    // Get tools available for this user (filtered to their connected integrations)
    const toolList = await composio.tools.list({ userIds: [accountId] } as any)
    const tools = (toolList as any).items ?? (toolList as any).tools ?? []

    if (!tools.length) return []

    return tools.map((t: any) => {
      const toolName: string = t.name ?? t.slug ?? ''
      return {
        name: toolName,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? t.parameters ?? { type: 'object', properties: {} },
        requiresApproval: requiresApproval(toolName),
        execute: async (input: Record<string, unknown>, ctx: ToolContext) => {
          const result = await composio.tools.execute(toolName, {
            userId: ctx.accountId,
            arguments: input,
          } as any)
          return result
        },
      } satisfies AgentTool
    })
  } catch (err: any) {
    // Non-fatal: if Composio is unavailable, session continues without integration tools
    console.error('Failed to load Composio tools:', err.message)
    return []
  }
}
