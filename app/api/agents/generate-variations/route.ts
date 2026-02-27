export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description } = await req.json()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const system = `You write system prompts for AI agents that help businesses automate tasks and communicate with clients.

A system prompt tells the AI agent exactly what to do: what to look for, who to focus on, what signals matter, how to act, and what a good outcome looks like.

You will produce 3 variations of a system prompt, each with a different communication style. Respond with valid JSON only, no markdown, in this exact shape:
{"variations":[{"tone":"Warm","prompt":"..."},{"tone":"Direct","prompt":"..."},{"tone":"Professional","prompt":"..."}]}

Each prompt: second person ("You are..."), 4-6 sentences, plain prose, specific to what was described.`

  const userPrompt = `Write 3 system prompt variations for an AI agent named "${name}"${description ? ` described as: "${description}"` : ''}.

The agent has access to business data and can draft messages, analyze patterns, flag issues, and surface insights for the owner to act on.`

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
    // Strip any accidental markdown fencing
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('[generate-variations] error:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Failed to generate variations' }, { status: 500 })
  }
}
