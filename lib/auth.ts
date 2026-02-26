import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import { supabaseAdmin } from './supabase'

const JWT_SECRET = process.env.JWT_SECRET!

export interface SessionUser {
  id: string
  email: string
  // Demo session fields
  userId?: string
  accountName?: string
  companyId?: string
  apiKey?: string
  isDemo?: boolean
  tier?: string
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return null
    
    const decoded = jwt.verify(token, JWT_SECRET) as SessionUser
    // Normalize demo sessions: userId field → id field
    if ((decoded as any).userId && !(decoded as any).id) {
      (decoded as any).id = (decoded as any).userId
    }
    return decoded
  } catch {
    return null
  }
}

export function createSessionToken(user: SessionUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '30d' })
}

export async function getUserWithGym(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  const { getAccountForUser } = await import('./db/accounts')
  const account = await getAccountForUser(userId)

  return { user, account }
}

export function isSubscribed(user: any): boolean {
  if (!user) return false
  const status = user.stripe_subscription_status
  return status === 'active' || status === 'trialing'
}

export function getTier(user: any): 'free' | 'starter' | 'pro' {
  if (!user) return 'free'
  if (!isSubscribed(user)) return 'free'
  
  const priceId = user.stripe_price_id
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro'
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return 'starter'
  return 'starter' // default paid tier
}
