import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const { intent, currentFields } = await req.json()

  if (!intent?.trim()) {
    return NextResponse.json({ error: 'Missing intent' }, { status: 400 })
  }

  const systemPrompt = `You are an expert at creating gym retention agent skills for boutique fitness gyms.

A skill has these fields:
- name: Short, outcome-oriented (e.g. "At-Risk Monitor", "Lapsed Member Win-Back")
- description: 1-2 sentences. What it does and when it fires.
- category: one of: retention, growth, billing
- trigger_condition: Plain English. When should this skill activate? Be specific about thresholds, timeframes, and exceptions.
- system_prompt: Instructions for the AI agent. What to do, what to say, what to avoid. Write as if instructing a human coach who works for the gym.
- tone_guidance: How to sound. e.g. "Warm, personal. First name only. Short sentences. Never pushy."
- escalation_rules: When to notify the gym owner instead of acting autonomously.
- success_criteria: How do we know the skill worked?
- default_value_usd: Estimated dollar value when this skill saves/converts a member (number only)

Respond with ONLY a valid JSON object with these exact keys. No markdown, no explanation.`

  const userPrompt = `Create a gym retention skill based on this intent:

"${intent}"

${currentFields?.name ? `Current name: ${currentFields.name}` : ''}
${currentFields?.description ? `Current description: ${currentFields.description}` : ''}

Generate the complete skill definition as JSON.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = (response.content[0] as any).text?.trim()

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let skill: any
    try {
      skill = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON', raw: text }, { status: 500 })
    }

    return NextResponse.json({ skill })
  } catch (err: any) {
    console.error('Generate skill error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
