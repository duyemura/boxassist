/**
 * skill-customizations.ts — Per-account instructions that extend a skill's behaviour.
 *
 * These are owner-written notes injected into the prompt between the skill body
 * (Layer 2) and business memories (Layer 3). They let owners steer a skill
 * without touching the global playbook file.
 *
 * DB migration (run once in Supabase SQL editor):
 *
 *   CREATE TABLE IF NOT EXISTS skill_customizations (
 *     id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
 *     account_id  UUID        NOT NULL,
 *     skill_id    TEXT        NOT NULL,
 *     notes       TEXT        NOT NULL,
 *     created_at  TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at  TIMESTAMPTZ DEFAULT NOW(),
 *     UNIQUE (account_id, skill_id)
 *   );
 *   CREATE INDEX IF NOT EXISTS skill_customizations_account_idx
 *     ON skill_customizations (account_id);
 */

import { supabaseAdmin } from '../supabase'

export interface SkillCustomization {
  id: string
  account_id: string
  skill_id: string
  notes: string
  created_at: string
  updated_at: string
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all skill customizations for an account as a Map<skill_id, notes>.
 * Used by the prompt builder — returns an empty Map on any error.
 */
export async function getSkillCustomizations(accountId: string): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('skill_customizations')
      .select('skill_id, notes')
      .eq('account_id', accountId)

    if (error) return new Map()
    return new Map((data ?? []).map(r => [r.skill_id, r.notes]))
  } catch {
    return new Map()
  }
}

/**
 * Fetch all skill customizations for an account as full objects.
 * Used by the API route for display.
 */
export async function listSkillCustomizations(accountId: string): Promise<SkillCustomization[]> {
  const { data, error } = await supabaseAdmin
    .from('skill_customizations')
    .select('*')
    .eq('account_id', accountId)
    .order('skill_id')

  if (error) throw error
  return data ?? []
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Create or update a skill customization.
 * skill_id is the YAML front-matter `id` of the skill file (e.g. 'churn-risk').
 */
export async function upsertSkillCustomization(
  accountId: string,
  skillId: string,
  notes: string,
): Promise<SkillCustomization> {
  const { data, error } = await supabaseAdmin
    .from('skill_customizations')
    .upsert(
      { account_id: accountId, skill_id: skillId, notes, updated_at: new Date().toISOString() },
      { onConflict: 'account_id,skill_id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Delete a skill customization (revert to global skill behaviour).
 */
export async function deleteSkillCustomization(
  accountId: string,
  skillId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('skill_customizations')
    .delete()
    .eq('account_id', accountId)
    .eq('skill_id', skillId)

  if (error) throw error
}
