export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { createCheckoutSession } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { tier } = await req.json()
  
  if (tier !== 'starter' && tier !== 'pro') {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', session.id)
    .single()
  
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const checkoutSession = await createCheckoutSession(user.id, user.email, tier, appUrl)
  
  // Store stripe customer ID
  if (checkoutSession.customer) {
    await supabaseAdmin
      .from('users')
      .update({ stripe_customer_id: checkoutSession.customer as string })
      .eq('id', user.id)
  }
  
  return NextResponse.json({ url: checkoutSession.url })
}
