export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateAgentInstructions } from '@/lib/agents/generate-instructions'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { agentType, agentName, accountName, stats, description } = await req.json()

    const instructions = await generateAgentInstructions({
      agentName: agentName || 'Agent',
      description: description || '',
      skillType: agentType || '',
      accountName: accountName || 'Your Gym',
      stats,
    })

    return NextResponse.json({ instructions })
  } catch (err: any) {
    console.error('[generate-instructions]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
