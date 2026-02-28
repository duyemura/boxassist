/**
 * Generate personalized agent instructions using Claude.
 *
 * Given the agent's name, description, skill type, and gym name,
 * generates a short, expert-level system prompt the owner can understand
 * in 10 seconds. Uses the skill file as context to avoid duplicating rules.
 */

import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '../models'
import { readFile } from 'fs/promises'
import path from 'path'

const SKILL_FILES: Record<string, string> = {
  at_risk_detector: 'churn-risk.md',
  churn_risk: 'churn-risk.md',
  payment_recovery: 'payment-recovery.md',
  win_back: 'win-back.md',
  new_member_onboarding: 'onboarding.md',
  onboarding: 'onboarding.md',
  lead_reactivation: 'lead-reactivation.md',
  lead_re_activation: 'lead-reactivation.md',
  lead_followup: 'lead-followup.md',
  lead_follow_up: 'lead-followup.md',
  monthly_churn_analysis: 'monthly-churn-analysis.md',
  ad_hoc: 'ad-hoc.md',
  staff_call_member: 'staff-call-member.md',
  milestone: 'milestone.md',
  referral: 'referral.md',
  renewal: 'renewal.md',
}

interface GenerateInstructionsInput {
  agentName: string
  description: string
  skillType: string
  accountName: string
  /** Optional business stats for extra personalization */
  stats?: Array<{ label: string; value: string | number }>
}

/**
 * Generate a personalized system prompt for an agent.
 * Returns the instruction text, or a sensible fallback if generation fails.
 */
export async function generateAgentInstructions(input: GenerateInstructionsInput): Promise<string> {
  const { agentName, description, skillType, accountName, stats } = input

  // Load the relevant skill file for context
  let skillContext = ''
  const skillFile = SKILL_FILES[skillType]
  if (skillFile) {
    try {
      const p = path.join(process.cwd(), 'lib', 'task-skills', skillFile)
      skillContext = await readFile(p, 'utf-8')
    } catch { /* skill file not found, proceed without */ }
  }

  const statsText = (stats || [])
    .map(s => `${s.label}: ${s.value}`)
    .join(', ')

  try {
    const client = new Anthropic()
    const msg = await client.messages.create({
      model: HAIKU,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Write a short, expert-level agent prompt for a gym's AI outreach agent. The gym owner sees this and should think "this knows exactly what to do."

Agent: "${agentName}"
Gym: "${accountName}"
Purpose: ${description}
${statsText ? `Business context: ${statsText}` : ''}
${skillContext ? `\nSkill playbook context:\n${skillContext.slice(0, 2000)}\n` : ''}
The prompt should be SHORT, under 120 words. Structure:

1. One sentence defining the role and voice: "You are... representing ${accountName}..."
2. 3-4 short rules (one line each) covering tone, length, and the core psychological technique (e.g. open loops, question bias, pattern interrupts, whatever the playbook emphasizes)
3. 2 example messages that nail the style. Short, psychologically compelling, the kind that force a reply. Use real first names. Each example should be under 20 words.
4. One sentence: what NEVER to do.

Rules:
- Use "${accountName}" by name
- NO specific numbers, counts, or data. The agent gets live data at runtime
- Examples are the most important part. They set the voice better than any rule
- Examples should feel like a text from a friend, not a business email
- Keep the whole thing scannable. The owner should read it in 10 seconds
- NEVER use emdashes in the output. Use commas or periods instead
- No markdown headers, no code blocks
- Use "- " for bullet list items`,
      }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    return text || buildFallbackInstructions(input)
  } catch (err) {
    console.error('[generate-instructions] AI generation failed:', err)
    return buildFallbackInstructions(input)
  }
}

/**
 * Build a sensible fallback when AI generation fails.
 */
function buildFallbackInstructions(input: GenerateInstructionsInput): string {
  return `You are the ${input.agentName} for ${input.accountName}. ${input.description}

- Keep messages short and personal, like a text from a friend
- Use the member's first name, reference specific details from their history
- Never use generic templates or corporate language
- Never pressure or guilt-trip. Be warm, curious, and genuinely helpful`
}
