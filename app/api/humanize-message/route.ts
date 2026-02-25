import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const { message, memberName, context } = await req.json()
  if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 })

  const system = `You are an expert at making AI-generated gym messages sound like they were written by a real human coach who genuinely cares about their members.

Rules:
- Remove any phrasing that sounds like it came from a bot or marketing template
- Keep the same core message and intent — don't change what's being said
- Use natural, conversational language — like a text from a real person
- Vary sentence length — mix short punchy sentences with longer ones
- Avoid: "I hope this message finds you well", "I wanted to reach out", "I noticed that", "as your coach", hollow affirmations
- Use contractions naturally (you've, I've, it's, we'd)
- First name only, never full name
- 3-5 sentences max unless it needs to be longer for context
- Return ONLY the rewritten message — no explanation, no quotes, no prefix`

  const prompt = `Member: ${memberName}
${context ? `Context: ${context}` : ''}

Message to humanize:
${message}`

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    const humanized = (response.content[0] as any).text?.trim()
    return NextResponse.json({ message: humanized })
  } catch (err: any) {
    console.error('Humanize error:', err)
    // On failure, return original — never block the send flow
    return NextResponse.json({ message })
  }
}
