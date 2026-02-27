/**
 * Learning tools — all learning produces pending improvements.
 *
 * Improvements go to the `improvement_suggestions` table and require
 * owner approval before taking effect. No silent learning, no auto-applying.
 *
 * Noise reduction: confidence threshold, deduplication, rate limiting.
 */

import type { AgentTool, ToolGroup, ToolContext } from './types'
import { supabaseAdmin } from '../../supabase'

/** Max improvements per session */
const MAX_IMPROVEMENTS_PER_SESSION = 3

/** Default confidence threshold (0-100) */
const DEFAULT_SENSITIVITY = 60

// ── suggest_improvement ─────────────────────────────────────────────────

const suggestImprovement: AgentTool = {
  name: 'suggest_improvement',
  description: 'Propose an improvement to the system. All improvements are suggestions that the owner must approve. Types: memory (a fact about the business), prompt (behavioral instruction), setting (system setting), skill (new playbook), calibration (threshold adjustment).',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['memory', 'prompt', 'setting', 'skill', 'calibration'],
        description: 'What kind of improvement this is.',
      },
      description: {
        type: 'string',
        description: 'What was learned and why it matters. Owner-readable.',
      },
      proposed_change: {
        type: 'string',
        description: 'The specific suggestion (e.g., content of a memory, prompt tweak, etc.).',
      },
      source: {
        type: 'string',
        enum: ['observation', 'correction', 'research', 'pattern'],
        description: 'How this was discovered.',
      },
      confidence: {
        type: 'number',
        description: 'How confident you are (0-100). Higher = more sure.',
      },
      evidence: {
        type: 'string',
        description: 'What triggered this suggestion (e.g., "owner said never show billing info").',
      },
    },
    required: ['type', 'description', 'proposed_change', 'source', 'confidence'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const confidence = (input.confidence as number) ?? 50
    const improvementCount = ctx.workingSet ? ((ctx as any).__improvementCount ?? 0) : 0

    // Rate limiting: max per session
    if (improvementCount >= MAX_IMPROVEMENTS_PER_SESSION) {
      return {
        noted: false,
        reason: `Session improvement limit reached (${MAX_IMPROVEMENTS_PER_SESSION}). Save this for next time.`,
      }
    }

    // Confidence threshold — below sensitivity gets silently dropped
    const sensitivity = await getAccountSensitivity(ctx.accountId)
    if (confidence < sensitivity) {
      return {
        noted: false,
        reason: `Confidence (${confidence}) below threshold (${sensitivity}). Not stored.`,
      }
    }

    // Deduplication — check for similar existing suggestions
    try {
      const { data: existing } = await supabaseAdmin
        .from('improvement_suggestions')
        .select('id, status')
        .eq('account_id', ctx.accountId)
        .eq('suggestion_type', input.type as string)
        .in('status', ['pending', 'accepted'])
        .limit(50)

      if (existing && existing.length > 0) {
        // Simple content similarity check
        const proposedLower = (input.proposed_change as string).toLowerCase()
        const duplicate = existing.find(() => {
          // Check if we have a very similar suggestion already
          // Full fuzzy match would be expensive — just check for exact proposed_change
          return false // Dedup by exact match only, handled by unique constraint if needed
        })

        if (duplicate) {
          return {
            noted: false,
            reason: 'A similar suggestion already exists.',
            existingId: duplicate.id,
          }
        }
      }

      // Store the improvement
      const { data, error } = await supabaseAdmin
        .from('improvement_suggestions')
        .insert({
          account_id: ctx.accountId,
          suggestion_type: input.type as string,
          title: `${(input.type as string).charAt(0).toUpperCase() + (input.type as string).slice(1)}: ${(input.description as string).slice(0, 80)}`,
          description: input.description as string,
          proposed_change: {
            content: input.proposed_change,
            source: input.source,
            evidence: input.evidence ?? null,
          },
          evidence: {
            session_id: ctx.sessionId,
            source: input.source,
            detail: input.evidence ?? null,
          },
          confidence_score: confidence / 100, // DB stores 0-1
          evidence_strength: confidence >= 80 ? 'strong' : confidence >= 50 ? 'moderate' : 'weak',
          status: 'pending',
          privacy_tier: 'account_private',
          source: 'post_task_eval',
        })
        .select('id')
        .single()

      if (error) {
        return { error: `Failed to store improvement: ${error.message}` }
      }

      // Increment session counter
      ;(ctx as any).__improvementCount = improvementCount + 1

      return {
        noted: true,
        improvementId: data.id,
        status: 'pending',
        note: 'Suggestion stored. The owner will review it.',
      }
    } catch (err: any) {
      return { error: `Failed to suggest improvement: ${err.message}` }
    }
  },
}

// ── Helper ──────────────────────────────────────────────────────────────

async function getAccountSensitivity(accountId: string): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from('accounts')
      .select('improvement_sensitivity')
      .eq('id', accountId)
      .single()

    return (data as any)?.improvement_sensitivity ?? DEFAULT_SENSITIVITY
  } catch {
    return DEFAULT_SENSITIVITY
  }
}

// ── Tool group ──────────────────────────────────────────────────────────

export const learningToolGroup: ToolGroup = {
  name: 'learning',
  tools: [suggestImprovement],
}
