// Direct PushPress API client (uses fetch instead of SDK to avoid compilation issues)
const PUSHPRESS_BASE_URL = 'https://api.pushpress.com/v3'

export function createPushPressClient(apiKey: string, companyId?: string) {
  return {
    apiKey,
    companyId: companyId || '',
    async fetch(path: string, options: RequestInit = {}) {
      const url = `${PUSHPRESS_BASE_URL}${path}`
      const hdrs: Record<string, string> = {
        'API-KEY': apiKey,
        'Content-Type': 'application/json',
      }
      // Only send company-id header if we have one (single-tenant keys don't need it)
      if (companyId) hdrs['company-id'] = companyId

      const res = await fetch(url, {
        ...options,
        headers: { ...hdrs, ...options.headers as Record<string, string> }
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`PushPress API error ${res.status}: ${text}`)
      }
      return res.json()
    }
  }
}

export interface AtRiskMember {
  id: string
  name: string
  email: string
  lastCheckin: Date | null
  daysSinceCheckin: number
  averageWeeklyCheckins: number
  membershipType: string
  memberSince: Date
  riskScore: number
}

export async function getAtRiskMembers(client: ReturnType<typeof createPushPressClient>, companyId: string): Promise<AtRiskMember[]> {
  try {
    // Try to fetch customers/members
    let members: any[] = []
    try {
      const response = await client.fetch(`/customers?limit=100`)
      // PushPress returns { data: { resultArray: [...] } }
      members =
        response?.data?.resultArray ??
        response?.data ??
        response?.resultArray ??
        (Array.isArray(response) ? response : [])
      if (!Array.isArray(members)) members = []
    } catch (e: any) {
      console.error('[pushpress] /customers fetch failed:', e?.message)
      members = []
    }

    if (members.length === 0) {
      if (process.env.DEMO_MODE === 'true') {
        return getSampleAtRiskMembers()
      }
      console.warn('[pushpress] getAtRiskMembers: no members returned from API')
      return []
    }

    const now = new Date()
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const atRiskMembers: AtRiskMember[] = []

    for (const member of members.slice(0, 50)) {
      try {
        // Get checkins for this member
        let checkins: any[] = []
        try {
          const checkinResp = await client.fetch(
            `/checkins/class?customer=${member.id}&limit=50`
          )
          // PushPress returns { data: { resultArray: [...] } }
          checkins =
            checkinResp?.data?.resultArray ??
            checkinResp?.data ??
            (Array.isArray(checkinResp) ? checkinResp : [])
          if (!Array.isArray(checkins)) checkins = []
        } catch { checkins = [] }

        const lastCheckin = getLastCheckinDate(checkins)
        const daysSinceCheckin = lastCheckin
          ? Math.floor((now.getTime() - lastCheckin.getTime()) / (1000 * 60 * 60 * 24))
          : 30

        const recentCheckins = checkins.filter((c: any) => {
          const d = new Date(c.date || c.checkedInAt || c.created_at || c.createdAt)
          return d >= thirtyDaysAgo
        })
        const averageWeeklyCheckins = recentCheckins.length / 4.3

        if (daysSinceCheckin >= 14) {
          let riskScore = 0
          if (daysSinceCheckin >= 14) riskScore += 40
          if (daysSinceCheckin >= 21) riskScore += 20
          if (daysSinceCheckin >= 30) riskScore += 20
          if (averageWeeklyCheckins < 1 && daysSinceCheckin > 10) riskScore += 20

          atRiskMembers.push({
            id: member.id || 'unknown',
            name: formatName(member),
            email: member.email || '',
            lastCheckin,
            daysSinceCheckin,
            averageWeeklyCheckins: Math.round(averageWeeklyCheckins * 10) / 10,
            membershipType: member.membership_type || member.membershipType || 'Monthly',
            memberSince: new Date(member.created_at || member.createdAt || now),
            riskScore
          })
        }
      } catch { /* skip member */ }
    }

    if (atRiskMembers.length === 0) {
      if (process.env.DEMO_MODE === 'true') {
        return getSampleAtRiskMembers()
      }
      return []
    }

    return atRiskMembers.sort((a, b) => b.riskScore - a.riskScore).slice(0, 20)
  } catch (error) {
    console.error('[pushpress] getAtRiskMembers error:', error)
    if (process.env.DEMO_MODE === 'true') {
      return getSampleAtRiskMembers()
    }
    return []
  }
}

export async function getMemberStats(client: ReturnType<typeof createPushPressClient>, companyId: string) {
  let gymName = 'Your Gym'
  let resolvedCompanyId = companyId || ''
  let totalMembers = 0

  // ── Step 1: Try /company endpoint first ──────────────────────────────────────
  try {
    const company = await client.fetch('/company')
    console.log('[pushpress] /company raw response:', JSON.stringify(company).slice(0, 800))

    // The API might return { data: { ... } } or the Company object directly
    const companyObj = company?.data ?? company
    if (companyObj?.name) gymName = companyObj.name
    if (companyObj?.id) resolvedCompanyId = companyObj.id
    console.log('[pushpress] /company parsed → name:', gymName, 'id:', resolvedCompanyId)
  } catch (err: any) {
    console.error('[pushpress] /company failed:', err.message)
  }

  // ── Step 2: Get customers (member count + fallback company ID) ───────────────
  // PushPress returns { data: { resultArray: [Customer, ...] } }
  try {
    const response = await client.fetch('/customers?limit=100')
    console.log('[pushpress] /customers raw response keys:', JSON.stringify(Object.keys(response || {})))

    // PushPress list endpoints return { data: { resultArray: [...] } }
    const customers: any[] =
      response?.data?.resultArray ??   // standard PushPress shape
      response?.data ??                // fallback: { data: [...] }
      response?.resultArray ??         // fallback: { resultArray: [...] }
      (Array.isArray(response) ? response : [])  // fallback: bare array

    totalMembers = Array.isArray(customers) ? customers.length : 0
    console.log('[pushpress] /customers found', totalMembers, 'members')

    // ── Fallback: extract companyId from first customer if /company didn't return it
    if (!resolvedCompanyId && Array.isArray(customers) && customers.length > 0) {
      const firstCustomer = customers[0]
      resolvedCompanyId = firstCustomer?.companyId || firstCustomer?.company_id || ''
      console.log('[pushpress] Extracted companyId from customer:', resolvedCompanyId)
    }
  } catch (err: any) {
    console.error('[pushpress] /customers failed:', err.message)
  }

  // ── Step 3: If we got a companyId from customers but no gym name, retry /company ─
  if (gymName === 'Your Gym' && resolvedCompanyId) {
    try {
      console.log('[pushpress] Retrying /company with company-id header:', resolvedCompanyId)
      const url = `${PUSHPRESS_BASE_URL}/company`
      const res = await fetch(url, {
        headers: {
          'API-KEY': client.apiKey,
          'company-id': resolvedCompanyId,
          'Content-Type': 'application/json',
        },
      })
      if (res.ok) {
        const company = await res.json()
        console.log('[pushpress] /company retry response:', JSON.stringify(company).slice(0, 800))
        const companyObj = company?.data ?? company
        if (companyObj?.name) gymName = companyObj.name
        if (companyObj?.id) resolvedCompanyId = companyObj.id
      } else {
        console.error('[pushpress] /company retry failed:', res.status, await res.text().catch(() => ''))
      }
    } catch (err: any) {
      console.error('[pushpress] /company retry error:', err.message)
    }
  }

  console.log('[pushpress] getMemberStats final →', { gymName, resolvedCompanyId, totalMembers })
  return { totalMembers, gymName, companyId: resolvedCompanyId }
}

function getLastCheckinDate(checkins: any[]): Date | null {
  if (!checkins.length) return null
  const sorted = checkins
    .map(c => new Date(c.date || c.checkedInAt || c.created_at || c.createdAt))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())
  return sorted[0] || null
}

function formatName(member: any): string {
  const first = member.first_name || member.firstName || ''
  const last = member.last_name || member.lastName || ''
  return `${first} ${last}`.trim() || member.name || 'Member'
}

function getSampleAtRiskMembers(): AtRiskMember[] {
  const now = new Date()
  return [
    {
      id: 'demo-1',
      name: 'Sarah Johnson',
      email: 'sarah.j@example.com',
      lastCheckin: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
      daysSinceCheckin: 18,
      averageWeeklyCheckins: 3.2,
      membershipType: 'Unlimited Monthly',
      memberSince: new Date(now.getTime() - 280 * 24 * 60 * 60 * 1000),
      riskScore: 75
    },
    {
      id: 'demo-2',
      name: 'Mike Torres',
      email: 'mike.t@example.com',
      lastCheckin: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
      daysSinceCheckin: 25,
      averageWeeklyCheckins: 2.1,
      membershipType: 'Monthly',
      memberSince: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000),
      riskScore: 85
    },
    {
      id: 'demo-3',
      name: 'Emma Walsh',
      email: 'emma.w@example.com',
      lastCheckin: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000),
      daysSinceCheckin: 16,
      averageWeeklyCheckins: 4.5,
      membershipType: 'Unlimited Monthly',
      memberSince: new Date(now.getTime() - 450 * 24 * 60 * 60 * 1000),
      riskScore: 60
    },
    {
      id: 'demo-4',
      name: 'James Park',
      email: 'james.p@example.com',
      lastCheckin: new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000),
      daysSinceCheckin: 22,
      averageWeeklyCheckins: 1.5,
      membershipType: 'Monthly',
      memberSince: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      riskScore: 80
    },
    {
      id: 'demo-5',
      name: 'Priya Sharma',
      email: 'priya.s@example.com',
      lastCheckin: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      daysSinceCheckin: 31,
      averageWeeklyCheckins: 0.8,
      membershipType: 'Monthly',
      memberSince: new Date(now.getTime() - 130 * 24 * 60 * 60 * 1000),
      riskScore: 90
    }
  ]
}
