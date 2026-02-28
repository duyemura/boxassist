import { supabaseAdmin } from '../supabase'

// ============================================================
// Types
// ============================================================

// Open string type — the AI can invent any category it needs.
// Well-known values below are hints for autocomplete and UI labelling only.
export type MemoryCategory = string
export const WELL_KNOWN_CATEGORIES = ['preference', 'member_fact', 'gym_context', 'business_stats', 'schedule_and_attendance', 'learned_pattern', 'data_lens'] as const
export type MemorySource = 'owner' | 'agent' | 'system'

export interface AccountMemory {
  id: string
  account_id: string
  category: MemoryCategory
  content: string
  importance: number
  scope: string
  member_id: string | null
  source: MemorySource
  active: boolean
  created_at: string
  updated_at: string
}

export interface CreateMemoryParams {
  accountId: string
  category: MemoryCategory
  content: string
  importance?: number
  scope?: string
  memberId?: string
  source: MemorySource
}

export interface GetMemoriesOpts {
  scope?: string
  category?: MemoryCategory
  memberId?: string
  minImportance?: number
}

// ============================================================
// getAccountMemories
// ============================================================

export async function getAccountMemories(
  accountId: string,
  opts: GetMemoriesOpts = {},
): Promise<AccountMemory[]> {
  let query = supabaseAdmin
    .from('memories')
    .select('*')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })

  if (opts.category) {
    query = query.eq('category', opts.category)
  }

  if (opts.minImportance) {
    query = query.gte('importance', opts.minImportance)
  }

  if (opts.memberId) {
    // Return both gym-wide and member-specific memories
    query = query.or(`member_id.is.null,member_id.eq.${opts.memberId}`)
  }

  if (opts.scope) {
    // Return both global and scope-specific memories
    query = query.or(`scope.eq.global,scope.eq.${opts.scope}`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`getAccountMemories failed: ${error.message}`)
  }

  return (data ?? []) as AccountMemory[]
}

// ============================================================
// createMemory
// ============================================================

export async function createMemory(params: CreateMemoryParams): Promise<AccountMemory> {
  const { data, error } = await supabaseAdmin
    .from('memories')
    .insert({
      account_id: params.accountId,
      category: params.category,
      content: params.content,
      importance: params.importance ?? 3,
      scope: params.scope ?? 'global',
      member_id: params.memberId ?? null,
      source: params.source,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`createMemory failed: ${error.message}`)
  }

  return data as AccountMemory
}

// ============================================================
// updateMemory
// ============================================================

export async function updateMemory(
  memoryId: string,
  updates: Partial<Pick<AccountMemory, 'content' | 'category' | 'importance' | 'scope'>>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('memories')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoryId)

  if (error) {
    throw new Error(`updateMemory failed: ${error.message}`)
  }
}

// ============================================================
// deactivateMemory (soft delete)
// ============================================================

export async function deactivateMemory(memoryId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('memories')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', memoryId)

  if (error) {
    throw new Error(`deactivateMemory failed: ${error.message}`)
  }
}

// ============================================================
// getMemoriesForPrompt
//
// Convenience function for agent prompt injection.
// Returns formatted text block of memories suitable for system prompt.
// ============================================================

export async function getMemoriesForPrompt(
  accountId: string,
  opts: { scope?: string; memberId?: string } = {},
): Promise<string> {
  const memories = await getAccountMemories(accountId, {
    scope: opts.scope,
    memberId: opts.memberId,
    minImportance: 3, // Only include importance >= 3 in prompts
  })

  if (memories.length === 0) return ''

  const grouped: Record<string, string[]> = {}
  for (const mem of memories) {
    const label = CATEGORY_LABELS[mem.category] ?? mem.category
    if (!grouped[label]) grouped[label] = []
    grouped[label].push(`- ${mem.content}`)
  }

  const sections = Object.entries(grouped)
    .map(([label, items]) => `### ${label}\n${items.join('\n')}`)
    .join('\n\n')

  return `## Gym Context & Memories\n\n${sections}`
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Owner Preferences',
  member_fact: 'Member Notes',
  gym_context: 'Business Profile',
  business_stats: 'Business Stats',
  schedule_and_attendance: 'Schedule & Attendance',
  learned_pattern: 'Learned Patterns',
  data_lens: 'Business Data',
}

/** Readable label for any category — falls back to title-casing the raw value. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
