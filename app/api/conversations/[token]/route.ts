import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 400 })

  const { data, error } = await supabase
    .from('agent_conversations')
    .select('id, role, text, member_name, created_at')
    .eq('action_id', token)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Parse agent_decision rows to extract readable info
  const messages = (data ?? []).map((row: any) => {
    if (row.role === 'agent_decision') {
      try {
        const parsed = JSON.parse(row.text)
        return {
          ...row,
          _decision: parsed,
        }
      } catch {
        return row
      }
    }
    return row
  })

  return NextResponse.json({ messages })
}
