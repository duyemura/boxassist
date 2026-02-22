import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any
})

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    features: ['1 autopilot skill', '3 scans per month', 'See up to 5 at-risk members', 'Read-only recommendations'],
    runsPerMonth: 3,
    maxAtRiskShown: 5,
    skills: ['at_risk_detector']
  },
  starter: {
    name: 'Starter',
    price: 4900, // cents
    priceId: process.env.STRIPE_STARTER_PRICE_ID || '',
    features: ['3 autopilot skills', '30 scans per month', 'One-click message sending', 'Email alerts', '90-day history'],
    runsPerMonth: 30,
    maxAtRiskShown: 999,
    skills: ['at_risk_detector', 'lead_followup', 'payment_failure']
  },
  pro: {
    name: 'Pro',
    price: 9700, // cents
    priceId: process.env.STRIPE_PRO_PRICE_ID || '',
    features: ['6 autopilot skills', 'Unlimited scans', 'Auto-send mode', '12-month trend reports', 'Priority support'],
    runsPerMonth: 9999,
    maxAtRiskShown: 9999,
    skills: ['at_risk_detector', 'lead_followup', 'payment_failure', 'birthday_messenger', 'capacity_optimizer', 'revenue_alerter']
  }
}

export async function createCheckoutSession(userId: string, email: string, tier: 'starter' | 'pro', appUrl: string) {
  const plan = PLANS[tier]
  
  // Create or get customer
  let customer: Stripe.Customer
  const existing = await stripe.customers.list({ email, limit: 1 })
  if (existing.data.length > 0) {
    customer = existing.data[0]
  } else {
    customer = await stripe.customers.create({ email, metadata: { userId } })
  }
  
  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `GymAgents ${plan.name}`,
          description: `GymAgents ${plan.name} — AI autopilot for your gym`
        },
        unit_amount: plan.price,
        recurring: { interval: 'month' }
      },
      quantity: 1
    }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { userId, tier }
    },
    success_url: `${appUrl}/dashboard?upgraded=true`,
    cancel_url: `${appUrl}/settings`,
    metadata: { userId, tier }
  })
  
  return session
}

export async function createPortalSession(customerId: string, appUrl: string) {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/settings`
  })
}
