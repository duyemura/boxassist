/**
 * agent-runtime.ts — Generic agent execution engine.
 *
 * Replaces the monolithic analyzeGymAI() with a composable model:
 * each agent row specifies a skill, and the runtime
 * assembles the prompt from base context + skill + memories + owner override.
 *
 * No hardcoded domain logic. The skill file tells the AI what to look for.
 * The data comes from the connector. The runtime just wires it together.
 */

import type { AccountSnapshot, AccountInsight, InsightType } from './GMAgent'
import { loadSkillPrompt, loadBaseContext, loadSkillIndex } from '../skill-loader'
import { getMemoriesForPrompt } from '../db/memories'
import { getSkillCustomizations } from '../db/skill-customizations'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentRunConfig {
  /** The skill_type from the agents table — maps to a skill file */
  skillType: string
  /** Optional owner-written prompt override (Layer 4) */
  systemPromptOverride?: string | null
  /** Account ID for memory injection */
  accountId: string
}

export interface AgentRunResult {
  insights: AccountInsight[]
  /** Raw token counts if available */
  tokensUsed?: { input: number; output: number }
}

interface ClaudeDep {
  evaluate: (system: string, prompt: string) => Promise<string>
}

// ── Output schema (injected into every agent prompt) ─────────────────────────

const OUTPUT_SCHEMA = `## Output
Respond with ONLY valid JSON (no markdown fences):
{
  "insights": [
    {
      "type": "a short snake_case label describing the situation (e.g. churn_risk, payment_failed, win_back, onboarding_check, or any label that fits)",
      "priority": "critical | high | medium | low",
      "memberId": "the person's id",
      "memberName": "the person's name",
      "memberEmail": "the person's email",
      "title": "short human-readable title (e.g. 'Sarah hasn\\'t visited in 12 days')",
      "detail": "2-3 sentence explanation of why this needs attention",
      "recommendedAction": "what the business should do",
      "estimatedImpact": "revenue or engagement at risk (e.g. '$150/mo at risk')"
    }
  ]
}
If no one needs attention, return: { "insights": [] }`

// ── Core execution ───────────────────────────────────────────────────────────

/**
 * Run a single agent's analysis against a business snapshot.
 *
 * Prompt assembly (4 layers):
 *   Layer 1: base.md (agent identity + general rules)
 *   Layer 2: skill file body (what to look for, how to respond)
 *   Layer 3: business memories (owner prefs, member facts, patterns)
 *   Layer 4: owner prompt override (optional customization)
 *   + output schema + formatted data
 *
 * Returns insights — no side effects (task creation is the caller's job).
 */
export async function runAgentAnalysis(
  config: AgentRunConfig,
  snapshot: AccountSnapshot,
  claude: ClaudeDep,
): Promise<AgentRunResult> {
  // Layer 1: Base agent context
  const baseContext = await loadBaseContext()

  // Layer 2: Skill-specific playbook
  let skillContext = ''
  try {
    skillContext = await loadSkillPrompt(config.skillType)
  } catch {
    // No matching skill — the AI will work with base context + data
  }

  // Layer 2b: Per-account skill customization (owner instructions for this skill)
  try {
    const customizations = await getSkillCustomizations(config.accountId)
    const skillId = await resolveSkillId(config.skillType)
    const customNote = skillId ? customizations.get(skillId) : undefined
    if (customNote && skillContext) {
      skillContext += `\n\n## Business Instructions for This Skill\n${customNote}`
    }
  } catch {
    // Non-fatal — customizations are optional
  }

  // Layer 3: Business memories
  let memories = ''
  try {
    memories = await getMemoriesForPrompt(config.accountId)
  } catch {
    // Non-fatal — memories are optional context
  }

  // Assemble system prompt
  const parts: string[] = []
  if (baseContext) parts.push(baseContext)
  if (skillContext) parts.push(skillContext)
  if (memories) parts.push(memories)
  if (config.systemPromptOverride) {
    parts.push(`## Owner Instructions\n${config.systemPromptOverride}`)
  }
  parts.push(OUTPUT_SCHEMA)

  const system = parts.join('\n\n---\n\n')

  // Format data for the prompt
  const dataPrompt = formatSnapshotCompact(snapshot)

  // Call Claude
  try {
    const response = await claude.evaluate(system, dataPrompt)
    const insights = parseInsightsResponse(response)
    return { insights }
  } catch (err) {
    console.error(`[agent-runtime] Claude call failed for skill=${config.skillType}:`, err)
    return { insights: [] }
  }
}

// ── Data formatting ──────────────────────────────────────────────────────────

/**
 * Format an AccountSnapshot into a compact prompt for the AI.
 * Includes all data sections — the skill file guides the AI's attention.
 */
export function formatSnapshotCompact(snapshot: AccountSnapshot): string {
  const now = new Date()

  // Segment people by status so the AI sees each group clearly
  const activeMembers: FormattedMember[] = []
  const prospects: FormattedMember[] = []
  const exMembers: FormattedMember[] = []

  for (const m of snapshot.members) {
    const formatted = formatMember(m, now)
    if (m.status === 'prospect') {
      prospects.push(formatted)
    } else if (m.status === 'cancelled') {
      exMembers.push(formatted)
    } else {
      activeMembers.push(formatted)
    }
  }

  // Also include any recentLeads that aren't already in prospects
  const existingProspectIds = new Set(prospects.map(p => p.id))
  for (const l of snapshot.recentLeads) {
    if (!existingProspectIds.has(l.id)) {
      prospects.push({
        id: l.id,
        name: l.name,
        email: l.email,
        status: 'prospect',
        memberSince: l.createdAt,
        monthlyRevenue: 0,
        daysSinceLastVisit: null,
        recentCheckins30d: 0,
        previousCheckins30d: 0,
        renewalDate: null,
        membershipType: null,
      })
    }
  }

  const paymentIssues = snapshot.paymentEvents
    .filter(p => p.eventType === 'payment_failed')
    .map(p => ({
      memberId: p.memberId,
      memberName: p.memberName,
      memberEmail: p.memberEmail,
      amount: p.amount,
      failedAt: p.failedAt,
    }))

  const parts: string[] = []
  parts.push(`Business: ${snapshot.accountName ?? 'Business'} (${activeMembers.length} active, ${exMembers.length} ex-members, ${prospects.length} prospects)\nSnapshot captured: ${snapshot.capturedAt}`)

  parts.push(`## Active Members:\n${JSON.stringify(activeMembers, null, 2)}`)

  if (exMembers.length > 0) {
    parts.push(`## Ex-Members (cancelled, potential win-back/reactivation):\n${JSON.stringify(exMembers, null, 2)}`)
  }

  if (prospects.length > 0) {
    parts.push(`## Prospects / Leads (never converted to members):\n${JSON.stringify(prospects, null, 2)}`)
  }

  if (paymentIssues.length > 0) {
    parts.push(`## Payment Issues:\n${JSON.stringify(paymentIssues, null, 2)}`)
  }

  parts.push('Analyze and return insights for people who need attention.')

  return parts.join('\n\n')
}

// ── Formatting helpers ──────────────────────────────────────────────────────

interface FormattedMember {
  id: string
  name: string
  email: string
  status: string
  memberSince: string
  monthlyRevenue: number
  daysSinceLastVisit: number | null
  recentCheckins30d: number
  previousCheckins30d: number
  renewalDate: string | null
  membershipType: string | null
}

function formatMember(m: AccountSnapshot['members'][number], now: Date): FormattedMember {
  const daysSince = m.lastCheckinAt
    ? Math.floor((now.getTime() - new Date(m.lastCheckinAt).getTime()) / 86_400_000)
    : null
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    status: m.status,
    memberSince: m.memberSince,
    monthlyRevenue: m.monthlyRevenue,
    daysSinceLastVisit: daysSince,
    recentCheckins30d: m.recentCheckinsCount,
    previousCheckins30d: m.previousCheckinsCount,
    renewalDate: m.renewalDate ?? null,
    membershipType: m.membershipType,
  }
}

// ── Skill ID resolution ──────────────────────────────────────────────────────

/**
 * Resolve a skill_type (e.g. 'at_risk_detector') to its YAML skill id
 * (e.g. 'churn-risk') so we can look up per-account customizations.
 * Returns null if no matching skill is found.
 */
async function resolveSkillId(skillType: string): Promise<string | null> {
  try {
    const skills = await loadSkillIndex()
    const skill = skills.find(s =>
      s.id === skillType ||
      s.filename === `${skillType}.md` ||
      s.triggers.includes(skillType)
    )
    return skill?.id ?? null
  } catch {
    return null
  }
}

// ── Response parsing ─────────────────────────────────────────────────────────

/** Parse Claude's JSON response into typed AccountInsight[] */
export function parseInsightsResponse(response: string): AccountInsight[] {
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return (parsed.insights ?? []).map((i: any) => ({
      type: (i.type || 'churn_risk') as InsightType,
      priority: (['critical', 'high', 'medium', 'low'].includes(i.priority)
        ? i.priority
        : 'medium') as AccountInsight['priority'],
      memberId: i.memberId,
      memberName: i.memberName,
      memberEmail: i.memberEmail,
      title: i.title ?? `${i.memberName} needs attention`,
      detail: i.detail ?? '',
      recommendedAction: i.recommendedAction ?? 'Review and reach out',
      estimatedImpact: i.estimatedImpact ?? '',
    }))
  } catch {
    console.error('[agent-runtime] Failed to parse insights JSON')
    return []
  }
}
