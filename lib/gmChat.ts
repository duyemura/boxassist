/**
 * lib/gmChat.ts
 *
 * Core GM Agent chat logic — classification, routing, specialist prompts.
 * Exported for direct unit testing and used by the /api/gm/chat route handler.
 */

import Anthropic from '@anthropic-ai/sdk'
import { SONNET, HAIKU } from './models'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskRoute = 'direct_answer' | 'inline_query' | 'prebuilt_specialist' | 'dynamic_specialist' | 'create_task'

export type ActionType = 'answer' | 'data_table' | 'recommendation' | 'task_created' | 'clarify'

export interface GMChatMessage {
  id?: string
  gymId?: string
  role: 'user' | 'assistant' | 'system_event'
  content: string
  route?: string
  actionType?: string
  data?: Array<Record<string, unknown>>
  taskId?: string
  thinkingSteps?: string[]
  createdAt?: string
}

export interface GMChatRequest {
  message: string
  gymId: string
  conversationHistory?: GMChatMessage[]
}

export interface GMChatResponse {
  reply: string
  route: TaskRoute
  actionType: ActionType
  data?: Array<Record<string, unknown>>
  taskId?: string
  thinkingSteps?: string[]
}

export interface GymContext {
  gymId: string
  gymName: string
  memberCount: number
}

// ── Specialist prompts ────────────────────────────────────────────────────────

export const SPECIALIST_PROMPTS: Record<string, string> = {
  churn_analysis: `You are a gym retention analyst. Analyze the provided member data and identify churn risk patterns. Look for: attendance drops, renewal proximity, new member struggles. Provide ranked insights with estimated revenue impact. Be specific and actionable.`,

  lead_funnel: `You are a gym sales analyst. Analyze lead conversion data. Identify where leads are dropping off. Provide specific, actionable recommendations to improve conversion at each stage.`,

  revenue_summary: `You are a gym financial analyst. Summarize revenue trends, MRR, at-risk revenue, and growth/decline patterns. Keep it practical and focused on what the gym owner can act on.`,

  operations: `You are a gym operations specialist. Answer operational questions about class fill rates, coach utilization, waiver compliance, member demographics, and overall gym health. Be direct and data-focused.`,
}

// ── pickSpecialist ─────────────────────────────────────────────────────────────

export function pickSpecialist(_classification: string, message: string): string {
  if (/churn|retent|retain|at.?risk|leaving|cancel/i.test(message)) return 'churn_analysis'
  if (/lead|convert|prospect|trial|intro/i.test(message)) return 'lead_funnel'
  if (/revenue|money|mrr|billing|payment/i.test(message)) return 'revenue_summary'
  return 'operations'
}

// ── classifyTask ──────────────────────────────────────────────────────────────

const VALID_ROUTES = new Set<TaskRoute>([
  'direct_answer',
  'inline_query',
  'prebuilt_specialist',
  'dynamic_specialist',
  'create_task',
])

export async function classifyTask(message: string): Promise<TaskRoute> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const classificationPrompt = `You are a classifier. Given this gym owner request, classify it into exactly one category:
- direct_answer: no gym data needed, pure reasoning/creative/general advice
- inline_query: needs one PushPress data fetch (members, checkins, enrollments, waivers)
- prebuilt_specialist: complex analysis — churn, revenue trends, lead funnel
- dynamic_specialist: novel task that doesn't fit above categories
- create_task: owner wants to create a task, set up a monitor, track something, or assign work to an agent

Request: "${message}"

Reply with ONLY the category name, nothing else.`

  const response = await client.messages.create({
    model: HAIKU,
    max_tokens: 20,
    messages: [{ role: 'user', content: classificationPrompt }],
  })

  const text = response.content.find(b => b.type === 'text')?.type === 'text'
    ? (response.content.find(b => b.type === 'text') as Anthropic.TextBlock).text.trim().toLowerCase()
    : 'direct_answer'

  // Clean up response (strip punctuation, extra whitespace)
  const cleaned = text.replace(/[^a-z_]/g, '')

  if (VALID_ROUTES.has(cleaned as TaskRoute)) {
    return cleaned as TaskRoute
  }

  return 'direct_answer'
}

// ── claudeRespond ─────────────────────────────────────────────────────────────

export async function claudeRespond(
  systemPrompt: string,
  userMessage: string,
  model: typeof HAIKU | typeof SONNET = SONNET,
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text.trim() : ''
}

// ── buildGymSystemPrompt ──────────────────────────────────────────────────────

export function buildGymSystemPrompt(gymContext: GymContext): string {
  return `You are the GM Agent for ${gymContext.gymName}, a boutique fitness gym with ${gymContext.memberCount} members.
You are a trusted advisor to the gym owner. Be direct, practical, and warm — like a knowledgeable colleague who knows the business.
Never use the word "AI" or "agent". Speak as if you know this gym personally.
Keep responses concise. If you need data you don't have, say what you'd look for.`
}

// ── buildGMSystemPromptWithAgents ─────────────────────────────────────────────
// Enhanced system prompt that includes sub-agent capability context.
// subAgentContext is loaded from .agents/agents/*.md files (server-side only).

export function buildGMSystemPromptWithAgents(
  gymContext: GymContext,
  subAgentContext: string,
): string {
  return `${buildGymSystemPrompt(gymContext)}

## Sub-agents You Can Delegate To

${subAgentContext}

When an owner asks you to create a task or assign work, extract: goal, which agent should own it, and the task type. Confirm what you created.`
}
