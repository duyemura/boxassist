/**
 * Thin wrapper around Resend email sending.
 * Kept in lib/ so it can be mocked in tests without touching API routes.
 */
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export interface SendEmailOptions {
  to: string
  subject: string
  body: string
  replyTo?: string
  gymName?: string
  fromName?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ id?: string; error?: string }> {
  const from = opts.fromName
    ? `${opts.fromName} <onboarding@resend.dev>`
    : `${opts.gymName ?? 'Your Gym'} <onboarding@resend.dev>`

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      replyTo: opts.replyTo,
    })
    if (error) return { error: error.message }
    return { id: data?.id }
  } catch (err: any) {
    return { error: err?.message ?? 'Unknown send error' }
  }
}
