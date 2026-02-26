export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { sendGmailMessage, isGmailConnected } from '@/lib/gmail'
import { updateTaskStatus, appendConversation } from '@/lib/db/tasks'


export async function POST(req: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { actionId, editedMessage, editedSubject } = await req.json()

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

    // Get the task
    const { data: task } = await supabaseAdmin
      .from('agent_tasks')
      .select('*')
      .eq('id', actionId)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Prevent duplicate sends — if autopilot already processed this task, reject
    if (task.status !== 'open' && task.status !== 'awaiting_approval') {
      return NextResponse.json({
        error: 'Task already processed',
        currentStatus: task.status,
      }, { status: 409 })
    }

    // Mark as approved
    await updateTaskStatus(actionId, 'awaiting_reply', {
      outcomeReason: editedMessage ? 'Approved by owner (edited)' : 'Approved by owner',
    })
    await supabaseAdmin
      .from('agent_tasks')
      .update({
        approved_at: new Date().toISOString(),
        approved_by: session.id,
      })
      .eq('id', actionId)

    // Use edited message if provided, otherwise fall back to original draft
    const ctx = (task.context ?? {}) as Record<string, unknown>
    const memberEmail = task.member_email ?? (ctx.memberEmail as string)
    const draftMessage = editedMessage || (ctx.draftMessage as string) || ''
    const messageSubject = editedSubject || (ctx.messageSubject as string) || 'Checking in'
    const accountId = task.gym_id

    if (memberEmail && draftMessage && accountId) {
      try {
        const gmailAddress = await isGmailConnected(accountId)
        if (gmailAddress) {
          await sendGmailMessage({
            accountId,
            to: memberEmail,
            subject: messageSubject,
            body: draftMessage,
          })
        } else {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            replyTo: `reply+${actionId}@lunovoria.resend.app`,
            to: memberEmail,
            subject: messageSubject,
            html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
              ${draftMessage.split('\n').map((p: string) => `<p>${p}</p>`).join('')}
            </div>`
          })
        }

        // Log the outbound message in conversation
        await appendConversation(actionId, {
          accountId,
          role: 'agent',
          content: draftMessage,
          agentName: 'retention',
        })
      } catch (emailError) {
        console.error('Email send error:', emailError)
      }
    }

    return NextResponse.json({ success: true, sent: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
