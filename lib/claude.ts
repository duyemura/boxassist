/**
 * GymAgents Claude runtime
 *
 * Two modes:
 * 1. runAtRiskDetector — classic direct-call for the existing at_risk_detector autopilot
 * 2. runAgentWithMCP — spawns the PushPress MCP server and gives Claude tool access to
 *    all PushPress data via the @pushpress/pushpress built-in MCP server
 */

import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { AtRiskMember } from './pushpress'
import { SONNET } from './models'

// Lazy singleton — avoids module-level init crashing Next.js build
let _anthropic: Anthropic | null = null
const anthropic = new Proxy({} as Anthropic, {
  get(_, prop) {
    if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    return (_anthropic as any)[prop]
  },
})

// ──────────────────────────────────────────────────────────────────────────────
// Simple text evaluator (no tools, no loop)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Call Claude and return raw text. Use for single-shot prompts that don't
 * need tool use or multi-turn conversation.
 *
 * Recommended: pass HAIKU for lightweight tasks (classification, profiling).
 * Defaults to SONNET if model is omitted.
 */
export async function callClaude(
  system: string,
  prompt: string,
  model: string = SONNET,
  maxTokens = 2000,
): Promise<string> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const content = response.content[0]
  return content.type === 'text' ? content.text : ''
}

// Path to the PP MCP server binary (installed as dep in the Next.js app)
const PP_MCP_BIN = require.resolve('@pushpress/pushpress/bin/mcp-server.js')

// ──────────────────────────────────────────────────────────────────────────────
// MCP-powered agent runner
// ──────────────────────────────────────────────────────────────────────────────

export interface MCPAgentOptions {
  accountName: string
  systemPrompt: string
  userPrompt: string
  apiKey: string
  companyId: string
  /** Max Claude turns before stopping (default 5) */
  maxTurns?: number
}

export interface MCPAgentResult {
  output: Record<string, unknown>
  toolCallCount: number
  rawText: string
}

/**
 * Run a Claude agent that has full access to PushPress data via the PP MCP server.
 * Spawns `mcp start` as a child process, connects via stdio, then runs a tool-use loop.
 */
export async function runAgentWithMCP(opts: MCPAgentOptions): Promise<MCPAgentResult> {
  const { accountName, systemPrompt, userPrompt, apiKey, companyId, maxTurns = 5 } = opts

  // Spawn the PP MCP server
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: [PP_MCP_BIN, 'start', '--api-key', apiKey, '--company-id', companyId],
    env: {
      ...process.env,
      // Ensure the MCP server uses dev API (same as our existing pushpress.ts)
      PUSHPRESS_SERVER: 'development'
    }
  })

  const mcpClient = new Client(
    { name: 'gymagents-runtime', version: '1.0.0' },
    { capabilities: {} }
  )

  await mcpClient.connect(transport)

  try {
    // Discover available tools
    const { tools: mcpTools } = await mcpClient.listTools()

    // Convert MCP tools to Anthropic tool format
    const anthropicTools: Anthropic.Tool[] = mcpTools.map(t => ({
      name: t.name,
      description: t.description ?? t.name,
      input_schema: (t.inputSchema ?? { type: 'object', properties: {} }) as Anthropic.Tool['input_schema']
    }))

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userPrompt }
    ]

    let toolCallCount = 0
    let finalText = ''

    // Agentic loop
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await anthropic.messages.create({
        model: SONNET,
        max_tokens: 4000,
        system: systemPrompt,
        tools: anthropicTools,
        messages
      })

      // Collect text
      const textBlocks = response.content.filter(b => b.type === 'text')
      if (textBlocks.length > 0) {
        finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')
      }

      // Stop if no tool use
      if (response.stop_reason !== 'tool_use') break

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content })

      // Execute each tool call via MCP
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        toolCallCount++

        let resultContent: string
        try {
          const mcpResult = await mcpClient.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>
          })
          // MCP result content is an array of content blocks
          const textContent = mcpResult.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n')
          resultContent = textContent || JSON.stringify(mcpResult.content)
        } catch (err: any) {
          resultContent = `Error calling ${block.name}: ${err.message}`
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    // Parse JSON from final text
    let output: Record<string, unknown> = { text: finalText }
    try {
      const match = finalText.match(/\{[\s\S]*\}/)
      if (match) output = JSON.parse(match[0])
    } catch {}

    return { output, toolCallCount, rawText: finalText }
  } finally {
    await mcpClient.close().catch(() => {})
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Existing at-risk detector (kept for backward compat with existing autopilot)
// ──────────────────────────────────────────────────────────────────────────────

export interface AgentAction {
  memberId: string
  memberName: string
  memberEmail: string
  riskLevel: 'high' | 'medium' | 'low'
  riskReason: string
  recommendedAction: string
  draftedMessage: string
  messageSubject: string
  confidence: number
  insights: string
}

export interface AgentOutput {
  summary: string
  totalAtRisk: number
  urgentCount: number
  actions: AgentAction[]
  gymInsight: string
  _usage?: { input_tokens: number; output_tokens: number }
}

/**
 * Repair common JSON issues from LLM output.
 * The most frequent problem: literal newlines inside JSON string values.
 * This walks the string character-by-character and escapes control characters
 * that appear inside quoted strings.
 */
function repairJSON(raw: string): string {
  let inString = false
  let result = ''
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    const prev = raw[i - 1]
    if (char === '"' && prev !== '\\') {
      inString = !inString
    }
    if (inString) {
      if (char === '\n') { result += '\\n'; continue }
      if (char === '\r') { result += '\\r'; continue }
      if (char === '\t') { result += '\\t'; continue }
    }
    result += char
  }
  return result
}

export async function runAtRiskDetector(
  accountName: string,
  members: AtRiskMember[],
  tier: string
): Promise<AgentOutput> {
  const membersToAnalyze = tier === 'free' ? members.slice(0, 5) : members

  const systemPrompt = `You are the autopilot assistant for ${accountName}, a boutique fitness gym.
You analyze member check-in patterns to identify members who are at risk of canceling their membership.
You speak directly to the gym owner in a warm, knowledgeable way — like a trusted advisor who knows their gym.
NEVER use the word "agent" or "AI". You are "the autopilot" or "your assistant."
You must output valid JSON only. No markdown, no prose outside the JSON.
IMPORTANT: In JSON string values, use \\n for line breaks — never include literal newlines inside a JSON string.`

  const userPrompt = `Your autopilot scanned ${accountName}'s check-in data and found ${membersToAnalyze.length} members who may be at risk.

Here's the data for each member:
${membersToAnalyze.map(m => `
Member: ${m.name}
Email: ${m.email}
Days since last check-in: ${m.daysSinceCheckin}
Average weekly check-ins (last 30 days): ${m.averageWeeklyCheckins}
Membership type: ${m.membershipType}
Member since: ${m.memberSince.toLocaleDateString()}
Risk score: ${m.riskScore}/100
`).join('\n---\n')}

For each member, reason step by step about:
1. What specifically triggered the risk flag (be specific about the pattern)
2. What's the most likely reason they've gone quiet
3. What's the best message to re-engage them — personal, warm, gym-owner voice. Reference their specific pattern. Never sound like a template.
4. What risk level they are (high = 21+ days, medium = 14-20 days, low = early warning)

Output this exact JSON structure:
{
  "summary": "one sentence summary of what your autopilot found today",
  "totalAtRisk": number,
  "urgentCount": number,
  "gymInsight": "one actionable insight about the pattern you're seeing",
  "actions": [
    {
      "memberId": "string",
      "memberName": "string",
      "memberEmail": "string",
      "riskLevel": "high" | "medium" | "low",
      "riskReason": "specific, personal reason (2-3 sentences)",
      "actionKind": "outreach" | "internal_task" | "owner_alert",
      "recommendedAction": "what the gym owner should do",
      "draftedMessage": "if actionKind=outreach: actual member message. if actionKind=internal_task: task description for owner. if actionKind=owner_alert: alert text for owner",
      "messageSubject": "email subject line (if outreach, else task title)",
      "confidence": 0-100,
      "insights": "one insight about this specific member"
    }
  ]
}`

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 8000,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  const text = content.text.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON found in response')

  let parsed: AgentOutput
  try {
    parsed = JSON.parse(jsonMatch[0]) as AgentOutput
  } catch {
    // Claude sometimes includes literal newlines inside JSON strings — repair and retry
    try {
      parsed = JSON.parse(repairJSON(jsonMatch[0])) as AgentOutput
    } catch (err2) {
      throw new Error(`Failed to parse agent response: ${(err2 as Error).message}`)
    }
  }
  // Attach token usage for cost tracking
  parsed._usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  }
  return parsed
}

// ──────────────────────────────────────────────────────────────────────────────
// Event-triggered agent (used by webhook handler)
// ──────────────────────────────────────────────────────────────────────────────

export async function runEventAgentWithMCP(opts: {
  gym: { id: string; account_name: string; pushpress_api_key: string; pushpress_company_id: string }
  agent: { skill_type: string; name?: string; system_prompt?: string; action_type?: string }
  eventType: string
  eventPayload: Record<string, unknown>
}): Promise<MCPAgentResult> {
  const { gym, agent, eventType, eventPayload } = opts

  const systemPrompt =
    agent.system_prompt ??
    buildDefaultEventSystemPrompt(eventType, gym.account_name)

  const userPrompt = buildEventUserPrompt(eventType, eventPayload, gym.account_name)

  return runAgentWithMCP({
    accountName: gym.account_name,
    systemPrompt,
    userPrompt,
    apiKey: gym.pushpress_api_key,
    companyId: gym.pushpress_company_id,
    maxTurns: 3
  })
}

function buildDefaultEventSystemPrompt(eventType: string, accountName: string): string {
  const prompts: Record<string, string> = {
    'customer.created': `You are the onboarding assistant for ${accountName}. A new member just joined! Use the PushPress tools to get their full profile, then draft a warm, personal welcome message from the gym owner. Mention what to expect their first week. Output JSON: { subject, body, notes }.`,
    'customer.status.changed': `You are the member engagement assistant for ${accountName}. A member's status just changed. Use PushPress tools to understand their history and current situation. If they've gone inactive or cancelled, draft a sincere, non-pushy win-back message. Output JSON: { subject, body, urgency, notes }.`,
    'enrollment.created': `You are the enrollment assistant for ${accountName}. A member just enrolled in a program. Use PushPress tools to look up their profile. Draft a congratulatory message with helpful next steps. Output JSON: { subject, body, notes }.`,
    'enrollment.status.changed': `You are the enrollment assistant for ${accountName}. A member's enrollment status changed. Use PushPress tools to check context. Draft an appropriate message. Output JSON: { subject, body, notes }.`,
    'checkin.created': `You are the engagement assistant for ${accountName}. A member just checked in. Use PushPress tools to check their checkin history — detect milestones like 10th visit, comeback after absence, streak. Output JSON: { milestone_detected, milestone_note, action_recommended }.`,
    'appointment.scheduled': `You are the appointment assistant for ${accountName}. An appointment was just booked. Use PushPress tools to look up the customer. Draft a confirmation message. Output JSON: { subject, body, notes }.`,
    'appointment.canceled': `You are the retention assistant for ${accountName}. An appointment was just canceled. Use PushPress tools to check their history. Draft a brief, non-pushy reschedule offer. Output JSON: { subject, body, notes }.`,
    'reservation.created': `You are the class engagement assistant for ${accountName}. A member just reserved a class spot. Use PushPress tools to check their profile. Consider sending encouragement if it's their first class or a comeback. Output JSON: { action_needed, subject, body }.`,
    'reservation.canceled': `You are the retention assistant for ${accountName}. A member just canceled a class reservation. Use PushPress tools to check their attendance pattern. If concerning, draft a light check-in. Output JSON: { action_needed, subject, body }.`,
  }
  return (
    prompts[eventType] ??
    `You are the AI assistant for ${accountName}. Use PushPress tools to understand the context of this event, then provide the most helpful response. Output JSON.`
  )
}

function buildEventUserPrompt(
  eventType: string,
  payload: Record<string, unknown>,
  accountName: string
): string {
  const data = (payload.data ?? payload.object ?? payload) as Record<string, unknown>
  const customerId = data.customerUuid ?? data.customer_id ?? data.customer ?? data.uuid ?? null

  return `Gym: ${accountName}
Event: ${eventType}
Timestamp: ${new Date().toISOString()}
${customerId ? `Customer ID: ${customerId} — use PushPress tools to look up their full profile and history.` : ''}
Event data:
${JSON.stringify(data, null, 2)}

Use the available PushPress tools to get context (customer profile, checkin history, etc.), then generate your response. Be specific — reference actual data you find. Output valid JSON only.`
}
