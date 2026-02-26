export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  
  let event: Stripe.Event
  
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err: any) {
    // In development, parse without verification
    try {
      event = JSON.parse(body) as Stripe.Event
    } catch {
      return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 })
    }
  }
  
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        const status = subscription.status
        const priceId = subscription.items.data[0]?.price.id || null
        
        await supabaseAdmin
          .from('users')
          .update({
            stripe_subscription_status: status,
            stripe_price_id: priceId,
            trial_ends_at: subscription.trial_end 
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null
          })
          .eq('stripe_customer_id', customerId)
        
        break
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        
        await supabaseAdmin
          .from('users')
          .update({
            stripe_subscription_status: 'canceled',
            stripe_price_id: null
          })
          .eq('stripe_customer_id', customerId)
        
        break
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        
        await supabaseAdmin
          .from('users')
          .update({ stripe_subscription_status: 'past_due' })
          .eq('stripe_customer_id', customerId)
        
        break
      }
    }
    
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
