import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { createSessionToken } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const JWT_SECRET = process.env.JWT_SECRET!

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    
    if (!token) {
      return NextResponse.redirect(new URL('/login?error=invalid', req.url))
    }
    
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; type: string }
    
    if (decoded.type !== 'magic_link') {
      return NextResponse.redirect(new URL('/login?error=invalid', req.url))
    }
    
    // Verify user exists
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single()
    
    if (!user) {
      return NextResponse.redirect(new URL('/login?error=notfound', req.url))
    }
    
    // Create session
    const sessionToken = createSessionToken({ id: user.id, email: user.email })
    
    // Check if gym is connected
    const { data: gym } = await supabaseAdmin
      .from('gyms')
      .select('id')
      .eq('user_id', user.id)
      .single()
    
    const redirectTo = gym ? '/dashboard' : '/connect'
    
    const response = NextResponse.redirect(new URL(redirectTo, req.url))
    response.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 // 30 days
    })
    
    return response
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.redirect(new URL('/login?error=expired', req.url))
  }
}
