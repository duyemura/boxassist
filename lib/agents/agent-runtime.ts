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
import { loadSkillPrompt, loadBaseContext } from '../skill-loader'
import { getMemoriesForPrompt } from '../db/memories'

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

  const members = snapshot.members.map(m => {
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
  })

  const paymentIssues = snapshot.paymentEvents
    .filter(p => p.eventType === 'payment_failed')
    .map(p => ({
      memberId: p.memberId,
      memberName: p.memberName,
      memberEmail: p.memberEmail,
      amount: p.amount,
      failedAt: p.failedAt,
    }))

  const leads = snapshot.recentLeads
    .filter(l => l.status === 'new' || l.status === 'contacted')
    .map(l => ({
      id: l.id,
      name: l.name,
      email: l.email,
      createdAt: l.createdAt,
      lastContactAt: l.lastContactAt,
      status: l.status,
    }))

  let prompt = `Business: ${snapshot.accountName ?? 'Business'} (${members.length} members)\nSnapshot captured: ${snapshot.capturedAt}\n`

  prompt += `\n## Members:\n${JSON.stringify(members, null, 2)}`

  if (paymentIssues.length > 0) {
    prompt += `\n\n## Payment Issues:\n${JSON.stringify(paymentIssues, null, 2)}`
  }

  if (leads.length > 0) {
    prompt += `\n\n## Open Leads:\n${JSON.stringify(leads, null, 2)}`
  }

  prompt += `\n\nAnalyze and return insights for people who need attention.`

  return prompt
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
