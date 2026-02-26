import { supabaseAdmin } from '../supabase'

/**
 * Get the account associated with a user via team_members join.
 * Replaces all direct `.from('accounts').eq('user_id', userId)` reads.
 */
export async function getAccountForUser(userId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from('team_members')
    .select('accounts(*)')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  return (data as any)?.accounts ?? null
}
