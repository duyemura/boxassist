export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { Resend } from 'resend'
import { createTask, appendConversation, DEMO_GYM_ID } from '@/lib/db/tasks'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const session = await getSession() as any

  if (!session?.isDemo) {
    return NextResponse.json({ error: 'Demo only' }, { status: 403 })
  }

  const visitorEmail: string = session?.demoVisitorEmail || ''
  const visitorName: string = session?.demoVisitorName || ''

  // visitorEmail from JWT is the default — can be overridden by body.toEmail below

  let message = ''
  let subject = 'Checking in on you'
  let toEmail = visitorEmail
  let automationLevel = 'draft_only'  // default: manual send = no auto-reply
  try {
    const body = await req.json()
    message = body?.message || ''
    subject = body?.subject || subject
    if (body?.toEmail) toEmail = body.toEmail
    if (body?.automationLevel) automationLevel = body.automationLevel
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!message) {
    return NextResponse.json({ error: 'No message provided' }, { status: 400 })
  }

  if (!toEmail) {
    return NextResponse.json({ error: 'No recipient email' }, { status: 400 })
  }

  // Escape the message for safe HTML rendering (preserve newlines)
  const htmlMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  try {
    // Create agent_task first — its UUID becomes the reply token
    const task = await createTask({
      gymId: DEMO_GYM_ID,
      assignedAgent: 'retention',
      taskType: 'churn_risk',
      memberEmail: toEmail,
      memberName: visitorName || toEmail.split('@')[0],
      goal: 'Re-engage the member and get them back into the gym',
      context: {
        source: 'demo',
        isDemo: true,
        automationLevel,
        gymName: 'PushPress East (Demo)',
        draftedMessage: message,
        messageSubject: subject,
      },
      requiresApproval: false,
    })

    const replyTo = `reply+${task.id}@lunovoria.resend.app`

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'GymAgents <noreply@lunovoria.resend.app>',
      replyTo,
      to: toEmail,
      subject,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fb;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;max-width:520px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:20px 28px 16px;border-bottom:2px solid #0063FF;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:24px;height:24px;background:#0063FF;border-radius:2px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-weight:700;font-size:12px;">G</span>
                  </td>
                  <td style="padding-left:8px;">
                    <span style="font-size:12px;font-weight:600;color:#374151;">GymAgents</span>
                    <span style="font-size:12px;color:#9ca3af;"> &middot; PushPress East (Demo)</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 24px;">
              <p style="font-size:15px;line-height:1.65;color:#111827;margin:0;">${htmlMessage}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
              <p style="font-size:11px;color:#9ca3af;line-height:1.6;margin:0 0 8px;">
                <strong style="color:#6b7280;">Hit reply and see what happens.</strong> The agent will read your response and decide whether to reply, close the task, or escalate — based on whether the goal is achieved.<br>
                In your gym, this comes from your own Gmail address.
              </p>
              <p style="font-size:11px;color:#9ca3af;margin:0;">
                <a href="https://app-orcin-one-70.vercel.app/login" style="color:#0063FF;text-decoration:none;font-weight:600;">Connect your gym &rarr;</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    })

    if (error) {
      console.error('Resend error:', error)
      return NextResponse.json({ error: 'Failed to send email', detail: error }, { status: 500 })
    }

    // Seed outbound conversation
    try {
      await appendConversation(task.id, {
        gymId: DEMO_GYM_ID,
        role: 'agent',
        content: message,
        agentName: 'retention',
      })
    } catch (dbErr) {
      console.log('demo send: conversation insert failed (non-fatal):', dbErr)
    }

    return NextResponse.json({ sent: true, emailId: data?.id, taskId: task.id })
  } catch (err) {
    console.error('Send email exception:', err)
    return NextResponse.json({ error: 'Unexpected error sending email' }, { status: 500 })
  }
}
