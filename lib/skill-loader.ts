/**
 * skill-loader.ts — Loads task-skill markdown files at runtime.
 *
 * Two modes of skill selection:
 *   1. Direct: task_type → skill file (legacy mapping, backward compatible)
 *   2. Semantic: goal/context description → matched against skill file headers
 *
 * Skill files have YAML front-matter with `applies_when` descriptions that
 * enable AI-style matching without hardcoded type enums.
 *
 * Combines _base.md (shared rules) with one or more task-specific skill files
 * to produce a full system prompt for Claude.
 */

import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { getMemoriesForPrompt } from './db/memories'
import { getSkillCustomizations } from './db/skill-customizations'

const SKILLS_DIR = join(process.cwd(), 'lib', 'task-skills')
const CONTEXT_DIR = join(process.cwd(), 'lib', 'context')

// ── Skill file metadata (parsed from YAML front-matter) ─────────────────────

export interface SkillMeta {
  id: string
  applies_when: string
  domain: string
  triggers: string[]
  filename: string
  content: string        // full file content (including front-matter)
  body: string           // content without front-matter
}

// ── Legacy mapping (backward compatible — used as fallback) ──────────────────

const TASK_TYPE_TO_FILE: Record<string, string> = {
  churn_risk: 'churn-risk.md',
  renewal_at_risk: 'churn-risk.md',
  win_back: 'win-back.md',
  lead_going_cold: 'lead-followup.md',
  lead_followup: 'lead-followup.md',
  payment_failed: 'payment-recovery.md',
  new_member_onboarding: 'onboarding.md',
  onboarding: 'onboarding.md',
  no_show: 'staff-call-member.md',
  monthly_analysis: 'monthly-churn-analysis.md',
  ad_hoc: 'ad-hoc.md',
  // Agent skill_type aliases (autopilot rows use these)
  at_risk_detector: 'churn-risk.md',
  payment_recovery: 'payment-recovery.md',
  lead_reactivation: 'lead-reactivation.md',
  lead_re_activation: 'lead-reactivation.md',  // agents created before skill_type fix (name-derived)
  lead_nurture: 'lead-followup.md',
  renewal: 'renewal.md',
  membership_renewal: 'renewal.md',
  referral: 'referral.md',
  member_referral: 'referral.md',
  milestone: 'milestone.md',
  member_milestone: 'milestone.md',
  anniversary: 'milestone.md',
}

// ── File cache ───────────────────────────────────────────────────────────────

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
 * Load the base agent context (lib/context/base.md).
 * This is Layer 1 of every agent prompt — who the agent is and how it works.
 * Returns empty string gracefully if the file is missing.
 */
export async function loadBaseContext(): Promise<string> {
  const cacheKey = '__base_context__'
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const content = await readFile(join(CONTEXT_DIR, 'base.md'), 'utf-8')
    cache.set(cacheKey, content)
    return content
  } catch {
    cache.set(cacheKey, '')
    return ''
  }
}

// ── YAML front-matter parsing ────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/

/**
 * Parse simple YAML front-matter from a skill file.
 * Supports: string values, arrays (bracket syntax: ["a", "b"]).
 * Does NOT use a full YAML parser — keeps dependencies minimal.
 */
export function parseSkillFrontMatter(content: string): {
  meta: Record<string, string | string[]>
  body: string
} {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { meta: {}, body: content }

  const yamlBlock = match[1]
  const body = content.slice(match[0].length)
  const meta: Record<string, string | string[]> = {}

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    // Handle array syntax: ["a", "b", "c"]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1)
      meta[key] = inner
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      // Strip surrounding quotes
      meta[key] = value.replace(/^["']|["']$/g, '')
    }
  }

  return { meta, body }
}

// ── Skill index (loaded once, cached) ────────────────────────────────────────

let skillIndex: SkillMeta[] | null = null

/**
 * Load and index all skill files (excluding _base.md).
 * Cached after first call — skill files don't change at runtime.
 */
export async function loadSkillIndex(): Promise<SkillMeta[]> {
  if (skillIndex) return skillIndex

  try {
    const files = await readdir(SKILLS_DIR)
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== '_base.md')

    const skills: SkillMeta[] = []
    for (const filename of mdFiles) {
      const content = await loadFile(filename)
      if (!content) continue

      const { meta, body } = parseSkillFrontMatter(content)

      skills.push({
        id: (meta.id as string) || filename.replace('.md', ''),
        applies_when: (meta.applies_when as string) || '',
        domain: (meta.domain as string) || 'general',
        triggers: (meta.triggers as string[]) || [],
        filename,
        content,
        body,
      })
    }

    skillIndex = skills
    return skills
  } catch {
    skillIndex = []
    return []
  }
}

/**
 * Select relevant skills for a goal/context description.
 *
 * Matches against skill `applies_when` descriptions and `triggers` arrays.
 * Returns up to `maxSkills` skills ranked by relevance.
 *
 * Matching strategy (simple keyword overlap — no AI call needed):
 *   1. Check if any trigger keyword appears in the description
 *   2. Score each skill by word overlap with applies_when
 *   3. Return top matches above a minimum threshold
 *
 * Falls back to legacy TASK_TYPE_TO_FILE mapping if taskType is provided.
 */
export async function selectRelevantSkills(
  description: string,
  opts?: { taskType?: string; maxSkills?: number },
): Promise<SkillMeta[]> {
  const maxSkills = opts?.maxSkills ?? 2
  const skills = await loadSkillIndex()

  if (skills.length === 0) return []

  const descLower = description.toLowerCase()
  const descWords = new Set(descLower.split(/\s+/).filter(w => w.length > 3))

  // Score each skill
  const scored = skills.map(skill => {
    let score = 0

    // Trigger match (strongest signal — exact keyword hit)
    for (const trigger of skill.triggers) {
      if (descLower.includes(trigger.toLowerCase())) {
        score += 10
      }
    }

    // applies_when word overlap
    const applyWords = skill.applies_when.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    for (const word of applyWords) {
      if (descWords.has(word)) {
        score += 1
      }
    }

    // Bonus for domain match in description
    if (descLower.includes(skill.domain)) {
      score += 3
    }

    return { skill, score }
  })

  // Sort by score descending, take top N above threshold
  const matches = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSkills)
    .map(s => s.skill)

  // If no semantic matches but we have a legacy taskType, fall back
  if (matches.length === 0 && opts?.taskType) {
    const filename = TASK_TYPE_TO_FILE[opts.taskType]
    if (filename) {
      const found = skills.find(s => s.filename === filename)
      if (found) return [found]
    }
  }

  return matches
}

/**
 * Load all skill file bodies (for AI analysis prompts).
 * Returns base + all skills concatenated with headers.
 */
export async function loadAllSkillSummaries(): Promise<string> {
  const skills = await loadSkillIndex()

  const summaries = skills.map(s => {
    return `### ${s.id}\n**When:** ${s.applies_when}\n**Domain:** ${s.domain}`
  })

  return summaries.join('\n\n')
}

// ── Public API (backward compatible) ─────────────────────────────────────────

/**
 * Load the combined skill prompt for a task type.
 * Returns _base.md + the task-specific skill file, separated by a divider.
 * Falls back to _base.md alone if no matching skill file exists.
 */
export async function loadSkillPrompt(taskType: string): Promise<string> {
  const base = await loadFile('_base.md')
  const skillFile = TASK_TYPE_TO_FILE[taskType]

  if (!skillFile) {
    // Try semantic fallback: maybe it's a new AI-assigned type
    const skills = await selectRelevantSkills(taskType, { maxSkills: 1 })
    if (skills.length > 0) {
      return `${base}\n\n---\n\n${skills[0].body}`
    }
    return base
  }

  const skill = await loadFile(skillFile)
  if (!skill) {
    return base
  }

  return `${base}\n\n---\n\n${skill}`
}

/**
 * Build a combined skill prompt from multiple relevant skills.
 * Used when the AI selects skills semantically rather than by type mapping.
 */
export async function buildMultiSkillPrompt(skills: SkillMeta[]): Promise<string> {
  const base = await loadFile('_base.md')

  if (skills.length === 0) return base

  const skillBodies = skills.map(s => s.body).join('\n\n---\n\n')
  return `${base}\n\n---\n\n${skillBodies}`
}

/**
 * Build a full system prompt for conversation evaluation.
 * Combines the skill context + gym memories + structured output instructions.
 *
 * Pass accountId to inject gym-specific memories. Without it, no memories are included
 * (safe for tests and contexts where DB isn't available).
 */
export async function buildEvaluationPrompt(
  taskType: string,
  opts?: { accountId?: string; memberId?: string },
): Promise<string> {
  const [baseContext, skillContextRaw, memories] = await Promise.all([
    loadBaseContext(),
    loadSkillPrompt(taskType),
    opts?.accountId
      ? loadMemories(opts.accountId, { scope: 'retention', memberId: opts.memberId })
      : Promise.resolve(''),
  ])

  const skillContext = opts?.accountId
    ? await appendSkillCustomization(skillContextRaw, taskType, opts.accountId)
    : skillContextRaw

  const baseBlock = baseContext ? `${baseContext}\n\n---\n\n` : ''
  const memoryBlock = memories ? `\n\n${memories}\n` : ''

  return `${baseBlock}${skillContext}${memoryBlock}

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
  "outcome": "engaged" | "churned" | "escalated" | "not_applicable",
  "noteworthy": ["short fact about the member worth remembering for future conversations, e.g. 'prefers morning classes', 'recovering from knee injury', 'travels for work in March'"] or []
}`
}

/**
 * Build a system prompt for message drafting (used by GMAgent).
 * Combines the skill context + gym memories + drafting instructions.
 */
export async function buildDraftingPrompt(
  taskType: string,
  opts?: { accountId?: string; memberId?: string },
): Promise<string> {
  const [baseContext, skillContextRaw, memories] = await Promise.all([
    loadBaseContext(),
    loadSkillPrompt(taskType),
    opts?.accountId
      ? loadMemories(opts.accountId, { scope: 'retention', memberId: opts.memberId })
      : Promise.resolve(''),
  ])

  const skillContext = opts?.accountId
    ? await appendSkillCustomization(skillContextRaw, taskType, opts.accountId)
    : skillContextRaw

  const baseBlock = baseContext ? `${baseContext}\n\n---\n\n` : ''
  const memoryBlock = memories ? `\n\n${memories}\n` : ''

  return `${baseBlock}${skillContext}${memoryBlock}

---

## Your Task Now

Draft a message from the gym to the member. Use the approach guidelines above (specifically Touch 1 for initial outreach). Write in a warm, personal, coach voice, not salesy or corporate.

CRITICAL: Never use emdashes in the message. Use commas, periods, or new sentences instead.

Return ONLY the message text, no subject line, no explanation, just the message.`
}

// ──────────────────────────────────────────────────────────────────────────────
// Memory loading (with graceful fallback — DB errors never break prompt building)
// ──────────────────────────────────────────────────────────────────────────────

async function loadMemories(
  accountId: string,
  opts: { scope?: string; memberId?: string },
): Promise<string> {
  try {
    return await getMemoriesForPrompt(accountId, opts)
  } catch (err) {
    console.warn('[skill-loader] Failed to load gym memories:', (err as Error).message)
    return ''
  }
}

// ── Skill customization injection ─────────────────────────────────────────────

/**
 * Append a per-account customization note to a skill prompt if one exists.
 * Maps taskType → skill id → looks up customization → appends as a new section.
 * Returns the original prompt unchanged if no customization is found.
 */
async function appendSkillCustomization(
  skillPrompt: string,
  taskType: string,
  accountId: string,
): Promise<string> {
  try {
    const [skills, customizations] = await Promise.all([
      loadSkillIndex(),
      getSkillCustomizations(accountId),
    ])

    // Resolve taskType to skill id: check direct id match, filename match, or trigger match
    const skill = skills.find(s =>
      s.id === taskType ||
      s.filename === `${taskType}.md` ||
      s.triggers.includes(taskType)
    )
    if (!skill) return skillPrompt

    const note = customizations.get(skill.id)
    if (!note) return skillPrompt

    return `${skillPrompt}\n\n## Business Instructions for This Skill\n${note}`
  } catch {
    return skillPrompt
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Clear all caches (for tests) */
export function _clearCaches(): void {
  cache.clear()
  skillIndex = null
}

/** Expose for testing: override base context without touching the filesystem */
export function _setBaseContextForTest(content: string): void {
  cache.set('__base_context__', content)
}
