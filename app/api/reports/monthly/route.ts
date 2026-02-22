import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { RetentionReportPDF } from '@/components/RetentionReport'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getSession() as any
  const isDemo = session?.isDemo

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month') // e.g. "2026-02"

  // Demo mode: return a sample PDF
  const gymName = isDemo ? 'PushPress East (Demo)' : (session?.gymName ?? 'Your Gym')
  const month = monthParam
    ? new Date(monthParam + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  let stats = {
    agentRuns: 14,
    membersFlagged: 23,
    messagesSent: 19,
    membersRetained: 11,
    totalValue: 1430,
    agentCost: 3.40,
    roiMultiplier: 421,
  }

  let actions = [
    { memberName: 'Sarah M.', playbook: 'At-Risk Monitor', outcome: 'Returned after message', value: '$130', date: '' },
    { memberName: 'James T.', playbook: 'Renewal At-Risk', outcome: 'Renewed membership', value: '$180', date: '' },
    { memberName: 'Dana K.', playbook: 'Lapsed Win-Back', outcome: 'Rejoined gym', value: '$130', date: '' },
    { memberName: 'Mike R.', playbook: 'At-Risk Monitor', outcome: 'Returned after message', value: '$130', date: '' },
    { memberName: 'Priya S.', playbook: 'New Member Onboarding', outcome: 'Completed orientation', value: '$130', date: '' },
    { memberName: 'Chris B.', playbook: 'Renewal At-Risk', outcome: 'Renewed membership', value: '$180', date: '' },
    { memberName: 'Lisa N.', playbook: 'At-Risk Monitor', outcome: 'Returned after message', value: '$130', date: '' },
    { memberName: 'Tom W.', playbook: 'Lapsed Win-Back', outcome: 'Rejoined gym', value: '$130', date: '' },
    { memberName: 'Amy L.', playbook: 'At-Risk Monitor', outcome: 'No response', value: '—', date: '' },
    { memberName: 'Ray H.', playbook: 'Failed Payment Recovery', outcome: 'Payment updated', value: '$90', date: '' },
    { memberName: 'Mia F.', playbook: 'At-Risk Monitor', outcome: 'No response', value: '—', date: '' },
  ]

  // Real gym: pull from DB
  if (!isDemo && session?.gymId) {
    try {
      const { data: runs } = await supabaseAdmin
        .from('agent_runs')
        .select('*')
        .eq('gym_id', session.gymId)
        .gte('completed_at', monthParam ? `${monthParam}-01` : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())

      if (runs && runs.length > 0) {
        const totalCost = runs.reduce((s: number, r: any) => s + (parseFloat(r.billed_usd) || 0), 0)
        const totalValue = runs.reduce((s: number, r: any) => s + (parseFloat(r.attributed_value_usd) || 0), 0)
        const flagged = runs.reduce((s: number, r: any) => s + (r.members_flagged || 0), 0)
        const sent = runs.reduce((s: number, r: any) => s + (r.messages_sent || 0), 0)
        stats = {
          agentRuns: runs.length,
          membersFlagged: flagged,
          messagesSent: sent,
          membersRetained: Math.round(sent * 0.55),
          totalValue,
          agentCost: totalCost,
          roiMultiplier: totalCost > 0 ? Math.round(totalValue / totalCost) : 0,
        }
      }
    } catch (err) {
      console.error('Report DB error:', err)
    }
  }

  try {
    const element = createElement(RetentionReportPDF, { gymName, month, stats, actions })
    const buffer = await renderToBuffer(element as any)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="gymagents-report-${monthParam ?? 'current'}.pdf"`,
      },
    })
  } catch (err: any) {
    console.error('PDF render error:', err)
    return NextResponse.json({ error: 'PDF generation failed', detail: err.message }, { status: 500 })
  }
}
