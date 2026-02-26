/**
 * skill-loader.ts — Loads task-skill markdown files at runtime.
 *
 * Combines _base.md (shared rules) with the task-type-specific skill file
 * to produce a full system prompt for Claude.
 *
 * File mapping: task_type → filename
 *   churn_risk       → churn-risk.md
 *   win_back         → win-back.md
 *   lead_followup    → lead-followup.md
 *   payment_failed   → payment-recovery.md
 *   onboarding       → onboarding.md
 *   no_show          → staff-call-member.md
 *   monthly_analysis → monthly-churn-analysis.md
 *   ad_hoc           → ad-hoc.md
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

const SKILLS_DIR = join(process.cwd(), 'lib', 'task-skills')

/** Map task_type values to their skill file names */
const TASK_TYPE_TO_FILE: Record<string, string> = {
  churn_risk: 'churn-risk.md',
  renewal_at_risk: 'churn-risk.md',  // same playbook as churn
  win_back: 'win-back.md',
  lead_going_cold: 'lead-followup.md',
  lead_followup: 'lead-followup.md',
  payment_failed: 'payment-recovery.md',
  new_member_onboarding: 'onboarding.md',
  onboarding: 'onboarding.md',
  no_show: 'staff-call-member.md',
  monthly_analysis: 'monthly-churn-analysis.md',
  ad_hoc: 'ad-hoc.md',
}

/** Cache loaded files in memory (they don't change at runtime) */
const cache = new Map<string, string>()

async function loadFile(filename: string): Promise<string> {
  const cached = cache.get(filename)
  if (cached) return cached

  try {
    const content = await readFile(join(SKILLS_DIR, filename), 'utf-8')
    cache.set(filename, content)
    return content
  } catch {
    return ''
  }
}

/**
 * Load the combined skill prompt for a task type.
 * Returns _base.md + the task-specific skill file, separated by a divider.
 * Falls back to _base.md alone if no matching skill file exists.
 */
export async function loadSkillPrompt(taskType: string): Promise<string> {
  const base = await loadFile('_base.md')
  const skillFile = TASK_TYPE_TO_FILE[taskType]

  if (!skillFile) {
    return base
  }

  const skill = await loadFile(skillFile)
  if (!skill) {
    return base
  }

  return `${base}\n\n---\n\n${skill}`
}

/**
 * Build a full system prompt for conversation evaluation.
 * Combines the skill context with structured output instructions.
 */
export async function buildEvaluationPrompt(taskType: string): Promise<string> {
  const skillContext = await loadSkillPrompt(taskType)

  return `${skillContext}

---

## Your Task Now

You are evaluating a conversation between the gym and a member. Using the skill guidelines above, decide the best next action.

## Output format
Respond ONLY with valid JSON (no markdown fences):

{
  "reasoning": "2-3 sentences on what the member is communicating and what a skilled coach would do",
  "action": "reply" | "close" | "escalate" | "wait",
  "reply": "the message to send (required for action=reply, optional for close/escalate)",
  "outcomeScore": 0-100,
  "resolved": true | false,
  "scoreReason": "one sentence on outcome quality",
  "outcome": "engaged" | "churned" | "escalated" | "not_applicable"
}`
}

/**
 * Build a system prompt for message drafting (used by GMAgent).
 * Combines the skill context with drafting-specific instructions.
 */
export async function buildDraftingPrompt(taskType: string): Promise<string> {
  const skillContext = await loadSkillPrompt(taskType)

  return `${skillContext}

---

## Your Task Now

Draft a message from the gym to the member. Use the approach guidelines above (specifically Touch 1 for initial outreach). Write in a warm, personal, coach voice — not salesy or corporate.

Return ONLY the message text — no subject line, no explanation, just the message.`
}
