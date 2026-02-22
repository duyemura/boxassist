import { NextRequest, NextResponse } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { sendGmailMessage, isGmailConnected } from '@/lib/gmail'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  try {
    const { actionId } = await req.json()
    
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', session.id)
      .single()
    
    const tier = getTier(user)
    
    if (tier === 'free') {
      return NextResponse.json({
        error: 'Upgrade required',
        upgradeRequired: true,
        message: "Upgrade to Starter to send messages with one click. Free tier is read-only."
      }, { status: 403 })
    }
    
    // Get the action
    const { data: action } = await supabaseAdmin
      .from('agent_actions')
      .select('*, agent_runs(gym_id)')
      .eq('id', actionId)
      .single()
    
    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }
    
    // Mark as approved
    await supabaseAdmin
      .from('agent_actions')
      .update({ approved: true })
      .eq('id', actionId)
    
    // Send the email — prefer Gmail (sends from owner's real address), fall back to Resend
    const content = action.content as any
    const gymId = action.agent_runs?.gym_id
    if (content.memberEmail && content.draftedMessage && gymId) {
      try {
        const gmailAddress = await isGmailConnected(gymId)
        if (gmailAddress) {
          // Send via owner's Gmail — member sees it from their actual coach
          await sendGmailMessage({
            gymId,
            to: content.memberEmail,
            subject: content.messageSubject || 'Checking in from the gym',
            body: content.draftedMessage,
          })
        } else {
          // No Gmail connected — fall back to Resend
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            replyTo: `reply+${actionId}@lunovoria.resend.app`,
            to: content.memberEmail,
            subject: content.messageSubject || 'Checking in from the gym',
            html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
              ${content.draftedMessage.split('\n').map((p: string) => `<p>${p}</p>`).join('')}
            </div>`
          })
        }
      } catch (emailError) {
        console.error('Email send error:', emailError)
      }
    }
    
    // Update autopilot approval rate
    const { data: run } = await supabaseAdmin
      .from('agent_runs')
      .select('gym_id')
      .eq('id', action.agent_run_id)
      .single()
    
    if (run) {
      // Calculate new approval rate
      const { data: allActions } = await supabaseAdmin
        .from('agent_actions')
        .select('approved, dismissed, agent_run_id')
        .eq('agent_run_id', action.agent_run_id)
      
      if (allActions) {
        const decided = allActions.filter(a => a.approved !== null || a.dismissed !== null)
        const approved = allActions.filter(a => a.approved === true)
        const rate = decided.length > 0 ? (approved.length / decided.length) * 100 : 0
        
        await supabaseAdmin
          .from('autopilots')
          .update({ approval_rate: Math.round(rate) })
          .eq('gym_id', run.gym_id)
          .eq('skill_type', 'at_risk_detector')
      }
    }
    
    return NextResponse.json({ success: true, sent: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
