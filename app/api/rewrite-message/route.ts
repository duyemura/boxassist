import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const { currentMessage, instruction, memberName, memberContext } = await req.json()

  if (!currentMessage || !instruction) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const systemPrompt = `You are a gym retention messaging assistant. You help gym owners rewrite member outreach messages.

Rules:
- Keep it short (3-5 sentences max unless the owner explicitly wants more)
- Warm, personal, human — sounds like a real coach, not a marketing email
- First name only, never full name
- No corporate language, no hollow phrases like "valued member"
- Match the instruction exactly — if they say "make it shorter", make it shorter
- Return ONLY the rewritten message text, nothing else — no intro, no explanation, no quotes`

  const userPrompt = `Member: ${memberName}
${memberContext ? `Context: ${memberContext}` : ''}

Current message:
${currentMessage}

Instruction: ${instruction}

Rewrite the message following the instruction:`

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rewritten = (response.content[0] as any).text?.trim()
    return NextResponse.json({ message: rewritten })
  } catch (err: any) {
    console.error('Rewrite error:', err)
    return NextResponse.json({ error: 'Rewrite failed' }, { status: 500 })
  }
}
