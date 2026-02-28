import { supabaseAdmin } from '../supabase'

export interface Account {
  id: string
  name?: string
  pushpress_api_key?: string | null
  pushpress_company_id?: string | null
  autopilot_enabled?: boolean
  autopilot_level?: string
  shadow_mode_until?: string | null
  daily_send_limit?: number
  timezone?: string | null
  [key: string]: unknown
}

/**
 * Get the account associated with a user via team_members join.
 * Replaces all direct `.from('accounts').eq('user_id', userId)` reads.
 */
export async function getAccountForUser(userId: string): Promise<Account | null> {
  const { data } = await supabaseAdmin
    .from('team_members')
    .select('accounts(*)')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  return (data as any)?.accounts ?? null
}
