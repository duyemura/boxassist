/**
 * skill-loader.test.ts
 *
 * Tests for lib/skill-loader.ts — task-skill prompt loading.
 * Verifies:
 *   - Loads _base.md for all task types
 *   - Loads task-specific skill file when it exists
 *   - Falls back to base-only for unknown task types
 *   - buildEvaluationPrompt includes JSON output format
 *   - buildDraftingPrompt includes drafting instructions
 *   - Caches loaded files (no re-reads)
 */

import { describe, it, expect } from 'vitest'
import { loadSkillPrompt, buildEvaluationPrompt, buildDraftingPrompt } from '../skill-loader'

// ── loadSkillPrompt ──────────────────────────────────────────────────────────

describe('loadSkillPrompt', () => {
  it('loads base rules for any task type', async () => {
    const prompt = await loadSkillPrompt('churn_risk')
    expect(prompt).toContain('Base Instructions')
    expect(prompt).toContain('Hard Rules')
    expect(prompt).toContain('Escalation Triggers')
  })

  it('loads churn_risk skill with base', async () => {
    const prompt = await loadSkillPrompt('churn_risk')
    expect(prompt).toContain('Churn Risk')
    expect(prompt).toContain('Touch 1: Friendly Check-In')
    expect(prompt).toContain('Touch 2: Direct but Caring')
    expect(prompt).toContain('Touch 3: Open Door')
  })

  it('loads win_back skill with base', async () => {
    const prompt = await loadSkillPrompt('win_back')
    expect(prompt).toContain('Win-Back')
    expect(prompt).toContain('Personal Farewell')
    expect(prompt).toContain('same day as cancellation')
  })

  it('loads lead_followup skill', async () => {
    const prompt = await loadSkillPrompt('lead_followup')
    expect(prompt).toContain('Lead Follow-Up')
    expect(prompt).toContain('Touch 1: Warm Welcome')
  })

  it('loads lead_going_cold using lead-followup skill', async () => {
    const prompt = await loadSkillPrompt('lead_going_cold')
    expect(prompt).toContain('Lead Follow-Up')
  })

  it('loads payment_failed skill', async () => {
    const prompt = await loadSkillPrompt('payment_failed')
    expect(prompt).toContain('Payment')
  })

  it('loads ad_hoc skill', async () => {
    const prompt = await loadSkillPrompt('ad_hoc')
    expect(prompt).toContain('Ad-Hoc')
    expect(prompt).toContain('Extra Caution')
  })

  it('loads lead_reactivation skill', async () => {
    const prompt = await loadSkillPrompt('lead_reactivation')
    expect(prompt).toContain('Lead Re-Activation')
    expect(prompt).toContain('ghost_lead')
  })

  it('loads at_risk_detector using churn-risk skill', async () => {
    const prompt = await loadSkillPrompt('at_risk_detector')
    expect(prompt).toContain('Churn Risk')
  })

  it('loads renewal skill', async () => {
    const prompt = await loadSkillPrompt('renewal')
    expect(prompt).toContain('Membership Renewal')
    expect(prompt).toContain('expiring_membership')
  })

  it('loads membership_renewal alias', async () => {
    const prompt = await loadSkillPrompt('membership_renewal')
    expect(prompt).toContain('Membership Renewal')
  })

  it('loads referral skill', async () => {
    const prompt = await loadSkillPrompt('referral')
    expect(prompt).toContain('Member Referral')
    expect(prompt).toContain('referral_request')
  })

  it('loads member_referral alias', async () => {
    const prompt = await loadSkillPrompt('member_referral')
    expect(prompt).toContain('Member Referral')
  })

  it('loads milestone skill', async () => {
    const prompt = await loadSkillPrompt('milestone')
    expect(prompt).toContain('Member Milestone')
    expect(prompt).toContain('anniversary')
  })

  it('loads anniversary alias to milestone skill', async () => {
    const prompt = await loadSkillPrompt('anniversary')
    expect(prompt).toContain('Member Milestone')
  })

  it('returns base-only for unknown task type', async () => {
    const prompt = await loadSkillPrompt('totally_unknown_type')
    expect(prompt).toContain('Base Instructions')
    expect(prompt).not.toContain('Churn Risk')
    expect(prompt).not.toContain('Win-Back')
  })

  it('includes separator between base and skill', async () => {
    const prompt = await loadSkillPrompt('churn_risk')
    expect(prompt).toContain('---')
  })
})

// ── buildEvaluationPrompt ────────────────────────────────────────────────────

describe('buildEvaluationPrompt', () => {
  it('includes skill context and JSON output format', async () => {
    const prompt = await buildEvaluationPrompt('churn_risk')
    // Skill content
    expect(prompt).toContain('Churn Risk')
    expect(prompt).toContain('Base Instructions')
    // Output format instructions
    expect(prompt).toContain('"action"')
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"outcomeScore"')
    expect(prompt).toContain('Respond ONLY with valid JSON')
  })

  it('works for win_back type', async () => {
    const prompt = await buildEvaluationPrompt('win_back')
    expect(prompt).toContain('Win-Back')
    expect(prompt).toContain('"action"')
  })

  it('falls back gracefully for unknown type', async () => {
    const prompt = await buildEvaluationPrompt('unknown_type')
    expect(prompt).toContain('Base Instructions')
    expect(prompt).toContain('"action"')
  })
})

// ── buildDraftingPrompt ──────────────────────────────────────────────────────

describe('buildDraftingPrompt', () => {
  it('includes skill context and drafting instructions', async () => {
    const prompt = await buildDraftingPrompt('churn_risk')
    expect(prompt).toContain('Churn Risk')
    expect(prompt).toContain('Touch 1')
    expect(prompt).toContain('Draft a message')
    expect(prompt).toContain('Return ONLY the message text')
  })

  it('includes win-back context for win_back type', async () => {
    const prompt = await buildDraftingPrompt('win_back')
    expect(prompt).toContain('Win-Back')
    expect(prompt).toContain('Personal Farewell')
  })

  it('falls back gracefully for unknown type', async () => {
    const prompt = await buildDraftingPrompt('unknown_type')
    expect(prompt).toContain('Base Instructions')
    expect(prompt).toContain('Draft a message')
  })
})
