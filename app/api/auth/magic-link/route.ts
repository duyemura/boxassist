import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

const resend = new Resend(process.env.RESEND_API_KEY!)
const JWT_SECRET = process.env.JWT_SECRET!

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    // Create or get user
    let { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single()
    
    if (!user) {
      const { data: newUser, error } = await supabaseAdmin
        .from('users')
        .insert({ email: normalizedEmail })
        .select()
        .single()
      
      if (error || !newUser) {
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
      }
      user = newUser
    }
    
    // Create magic link token (expires in 15 minutes)
    const token = jwt.sign(
      { userId: user.id, email: normalizedEmail, type: 'magic_link' },
      JWT_SECRET,
      { expiresIn: '15m' }
    )
    
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const magicLink = `${appUrl}/api/auth/verify?token=${token}`
    
    // Send magic link email
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@gymagents.com',
      to: normalizedEmail,
      subject: 'Your GymAgents login link',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin: 0; padding: 0; background-color: #F5F7FA; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F5F7FA; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                  
                  <!-- Header bar -->
                  <tr>
                    <td style="background-color: #0063FF; padding: 24px 32px;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 8px 12px; margin-right: 10px;">
                            <span style="color: #ffffff; font-weight: 700; font-size: 16px; letter-spacing: -0.3px;">G</span>
                          </td>
                          <td style="padding-left: 10px;">
                            <span style="color: #ffffff; font-weight: 700; font-size: 18px; letter-spacing: -0.3px;">GymAgents</span>
                            <span style="color: rgba(255,255,255,0.6); font-size: 12px; display: block; margin-top: 1px;">Powered by PushPress</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding: 40px 32px 32px;">
                      <h1 style="font-size: 22px; font-weight: 700; color: #1A2B3C; margin: 0 0 12px 0; letter-spacing: -0.3px;">
                        Your login link is ready
                      </h1>
                      <p style="color: #4B5563; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0;">
                        Click the button below to log in to GymAgents. This link expires in 15 minutes.
                      </p>
                      
                      <a href="${magicLink}" 
                         style="display: inline-block; background-color: #0063FF; color: #ffffff; font-weight: 600; 
                                padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 15px;
                                letter-spacing: -0.1px;">
                        Log In to GymAgents →
                      </a>

                      <p style="color: #9CA3AF; font-size: 13px; margin: 32px 0 0 0; line-height: 1.5;">
                        If you didn't request this, you can safely ignore this email. The link will expire on its own.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #F5F7FA; padding: 20px 32px; border-top: 1px solid #E5E7EB;">
                      <p style="color: #9CA3AF; font-size: 12px; margin: 0; line-height: 1.5;">
                        GymAgents · Powered by <a href="https://pushpress.com" style="color: #0063FF; text-decoration: none;">PushPress</a>
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Magic link error:', error)
    return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
  }
}
