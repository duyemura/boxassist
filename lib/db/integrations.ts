/**
 * DB helpers for account integrations.
 *
 * `account_integrations` tracks which integrations are connected per account,
 * the Composio connected account ID, and any extra metadata (e.g. Twilio from_number).
 *
 * Composio is the source of truth for credentials and tokens.
 * This table is our local cache + metadata store.
 */

import { supabaseAdmin } from '../supabase'

export interface IntegrationRecord {
  id: string
  accountId: string
  integrationId: string
  composioAccountId: string | null
  composioAuthConfig: string | null
  connectedAt: string
  metadata: Record<string, unknown>
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getIntegrations(accountId: string): Promise<IntegrationRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('account_integrations')
    .select('*')
    .eq('account_id', accountId)
    .order('connected_at', { ascending: false })

  if (error) throw new Error(`getIntegrations failed: ${error.message}`)

  return (data ?? []).map(rowToRecord)
}

export async function getIntegration(
  accountId: string,
  integrationId: string,
): Promise<IntegrationRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('account_integrations')
    .select('*')
    .eq('account_id', accountId)
    .eq('integration_id', integrationId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getIntegration failed: ${error.message}`)
  }

  return data ? rowToRecord(data) : null
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function upsertIntegration(
  accountId: string,
  integrationId: string,
  composioAccountId: string,
  metadata: Record<string, unknown> = {},
  composioAuthConfig?: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('account_integrations')
    .upsert(
      {
        account_id: accountId,
        integration_id: integrationId,
        composio_account_id: composioAccountId,
        composio_auth_config: composioAuthConfig ?? null,
        connected_at: new Date().toISOString(),
        metadata,
      },
      { onConflict: 'account_id,integration_id' },
    )

  if (error) throw new Error(`upsertIntegration failed: ${error.message}`)
}

export async function deleteIntegration(
  accountId: string,
  integrationId: string,
): Promise<string | null> {
  // Fetch the composio_account_id first so caller can revoke from Composio
  const existing = await getIntegration(accountId, integrationId)

  const { error } = await supabaseAdmin
    .from('account_integrations')
    .delete()
    .eq('account_id', accountId)
    .eq('integration_id', integrationId)

  if (error) throw new Error(`deleteIntegration failed: ${error.message}`)

  return existing?.composioAccountId ?? null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToRecord(row: any): IntegrationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    integrationId: row.integration_id,
    composioAccountId: row.composio_account_id ?? null,
    composioAuthConfig: row.composio_auth_config ?? null,
    connectedAt: row.connected_at,
    metadata: row.metadata ?? {},
  }
}
