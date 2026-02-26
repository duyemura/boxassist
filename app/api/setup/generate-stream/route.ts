export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { goal, successMetric } = await req.json()
  if (!goal) return new Response('goal is required', { status: 400 })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const system = `You write system prompts for AI agents that help businesses automate tasks, analyze data, and communicate with clients.

A system prompt tells the AI agent exactly what to do: what to look for, who or what to focus on, what signals matter, how to act, and what a good outcome looks like.

Write in second person ("You are..."). 4-6 focused sentences. No headers, no bullet points, no lists. Plain prose the agent can follow directly. Be specific to what the owner described — don't be generic or add things they didn't ask for.`

  const prompt = `Write a system prompt for an AI agent.

What the owner wants it to do: ${goal}
${successMetric ? `What success looks like: ${successMetric}` : ''}

The agent has access to business data and can draft messages, analyze patterns, flag issues, and surface insights for the owner to act on.`

  const stream = client.messages.stream({
    model: HAIKU,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: prompt }],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
