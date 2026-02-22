import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? 'demo-ZGFuQHB1c2hwcmVz'
  const logs: string[] = []

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    logs.push(`Looking up token: ${token}`)

    const { data, error } = await supabase
      .from('agent_actions')
      .select('id, action_type, content')
      .eq('content->>_replyToken', token)
      .single()

    if (error) logs.push(`DB error: ${error.message}`)
    if (data) logs.push(`Found action: ${data.id} type=${data.action_type}`)
    else logs.push('No action found')

    const { data: convos, error: convErr } = await supabase
      .from('agent_conversations')
      .select('id, role, created_at')
      .eq('action_id', token)
      .order('created_at', { ascending: false })

    if (convErr) logs.push(`Convos error: ${convErr.message}`)
    else logs.push(`Conversations: ${convos?.length ?? 0} rows — ${convos?.map(c => c.role).join(', ')}`)

    // Try inserting a test inbound row
    const { error: insertErr } = await supabase
      .from('agent_conversations')
      .insert({
        action_id: token,
        gym_id: 'demo',
        role: 'inbound',
        text: '[DEBUG TEST] This is a test inbound message',
        member_email: 'dan@pushpress.com',
        member_name: 'Dan (debug)',
      })

    if (insertErr) logs.push(`Insert error: ${insertErr.message}`)
    else logs.push('Test inbound row inserted successfully')

    return NextResponse.json({ ok: true, logs })
  } catch (e: any) {
    logs.push(`Exception: ${e?.message ?? String(e)}`)
    return NextResponse.json({ ok: false, logs }, { status: 500 })
  }
}
