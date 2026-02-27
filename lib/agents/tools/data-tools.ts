/**
 * Data tools — read-only tools that fetch from PushPress and Supabase.
 *
 * Never require approval. The agent calls these to understand the situation
 * before taking action. Smart filters prevent data dumps.
 */

import type { AgentTool, ToolGroup, ToolContext } from './types'
import { ppGet, buildMemberData } from '../../pushpress-platform'
import { getOpenTasksForGym } from '../../db/tasks'
import { getAccountMemories } from '../../db/memories'
import { supabaseAdmin } from '../../supabase'

// ── Helpers ──────────────────────────────────────────────────────────────

interface PPCustomerV3 {
  id: string
  uuid?: string
  name?: { first?: string; last?: string }
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  role?: string
  created_at?: string
}

interface PPEnrollment {
  id: string
  customerId?: string
  customer_id?: string
  status?: string
  billingSchedule?: { period?: string; interval?: number }
  billing_schedule?: { period?: string; interval?: number }
  amount?: number
  nextCharge?: string
  next_charge?: string
}

interface PPCheckin {
  id: string
  customer?: string
  customerId?: string
  timestamp?: number
  kind?: string
  role?: string
  result?: string
}

function customerName(c: PPCustomerV3): string {
  if (c.name?.first || c.name?.last) {
    return `${c.name.first ?? ''} ${c.name.last ?? ''}`.trim()
  }
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown'
}

function customerId(c: PPCustomerV3): string {
  return c.uuid ?? c.id
}

// ── get_members ─────────────────────────────────────────────────────────

const getMembers: AgentTool = {
  name: 'get_members',
  description: 'Fetch members with optional filters. Returns a compact summary plus the requested slice. Use filters to get exactly who you need — avoid fetching everyone.',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'cancelled', 'prospect', 'all'],
        description: 'Filter by membership status. Default: all.',
      },
      days_absent_min: {
        type: 'number',
        description: 'Only return members who haven\'t visited in at least this many days.',
      },
      limit: {
        type: 'number',
        description: 'Max members to return (default 10, max 50). Use small limits and iterate.',
      },
      sort_by: {
        type: 'string',
        enum: ['days_absent', 'revenue', 'last_visit', 'name'],
        description: 'Sort order. Default: days_absent (most absent first).',
      },
    },
    required: [],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const limit = Math.min((input.limit as number) || 10, 50)
    const statusFilter = (input.status as string) || 'all'
    const daysAbsentMin = (input.days_absent_min as number) || 0
    const sortBy = (input.sort_by as string) || 'days_absent'
    const now = new Date()

    try {
      // Fetch customers from PushPress
      const customers = await ppGet<PPCustomerV3>(ctx.apiKey, '/customers', {}, ctx.companyId)

      // Fetch enrollments and checkins
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000)

      let enrollments: PPEnrollment[] = []
      let checkins: PPCheckin[] = []

      try {
        enrollments = await ppGet<PPEnrollment>(ctx.apiKey, '/enrollments', {}, ctx.companyId)
      } catch { /* graceful degradation */ }

      try {
        checkins = await ppGet<PPCheckin>(
          ctx.apiKey, '/checkins',
          { timestamp_min: Math.floor(sixtyDaysAgo.getTime() / 1000).toString() },
          ctx.companyId,
        )
      } catch { /* graceful degradation */ }

      // Build member data using existing buildMemberData
      const enrollmentMap = new Map<string, PPEnrollment>()
      for (const e of enrollments) {
        const cid = e.customerId ?? e.customer_id ?? ''
        enrollmentMap.set(cid, e)
      }

      const checkinMap = new Map<string, PPCheckin[]>()
      for (const c of checkins) {
        const cid = c.customer ?? c.customerId ?? ''
        if (!checkinMap.has(cid)) checkinMap.set(cid, [])
        checkinMap.get(cid)!.push(c)
      }

      const members = customers.map(c => {
        const cid = customerId(c)
        const enrollment = enrollmentMap.get(cid)
        const memberCheckins = checkinMap.get(cid) ?? []
        const schedule = enrollment?.billingSchedule ?? enrollment?.billing_schedule
        const monthlyRevenue = enrollment?.amount && schedule?.period
          ? normalizeRevenue(schedule.period, schedule.interval ?? 1, enrollment.amount)
          : 0

        const memberData = buildMemberData(
          { id: cid, companyId: '', name: { first: c.name?.first ?? c.first_name ?? '', last: c.name?.last ?? c.last_name ?? '' }, email: c.email ?? '', role: c.role },
          enrollment ? { id: enrollment.id, customerId: cid, status: (enrollment.status ?? 'active') as any, billingSchedule: (schedule ?? { period: 'month', interval: 1 }) as any } : null,
          memberCheckins as any[],
          now,
          monthlyRevenue,
        )

        const daysSinceVisit = memberData.lastCheckinAt
          ? Math.floor((now.getTime() - new Date(memberData.lastCheckinAt).getTime()) / 86_400_000)
          : null

        return {
          ...memberData,
          daysSinceVisit,
        }
      })

      // Filter
      let filtered = members.filter(m => {
        if (statusFilter !== 'all' && m.status !== statusFilter) return false
        if (daysAbsentMin > 0 && (m.daysSinceVisit === null || m.daysSinceVisit < daysAbsentMin)) return false
        // Exclude already-processed members from this session
        if (ctx.workingSet.processed.includes(m.id)) return false
        return true
      })

      const totalMatching = filtered.length

      // Sort
      filtered.sort((a, b) => {
        switch (sortBy) {
          case 'revenue': return b.monthlyRevenue - a.monthlyRevenue
          case 'name': return a.name.localeCompare(b.name)
          case 'last_visit': return (b.daysSinceVisit ?? 999) - (a.daysSinceVisit ?? 999)
          case 'days_absent':
          default: return (b.daysSinceVisit ?? 999) - (a.daysSinceVisit ?? 999)
        }
      })

      // Slice
      const slice = filtered.slice(0, limit)

      return {
        total_matching: totalMatching,
        returned: slice.length,
        excluded_already_processed: ctx.workingSet.processed.length,
        members: slice.map(m => ({
          id: m.id,
          name: m.name,
          email: m.email,
          status: m.status,
          daysSinceVisit: m.daysSinceVisit,
          monthlyRevenue: m.monthlyRevenue,
          recentCheckins30d: m.recentCheckinsCount,
          previousCheckins30d: m.previousCheckinsCount,
          memberSince: m.memberSince,
          membershipType: m.membershipType,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch members: ${err.message}` }
    }
  },
}

function normalizeRevenue(period: string, interval: number, amount: number): number {
  if (!period || !amount) return 0
  switch (period) {
    case 'week': return (amount / interval) * 4.33
    case 'month': return amount / interval
    case 'year': return amount / (interval * 12)
    default: return amount
  }
}

// ── get_member_detail ───────────────────────────────────────────────────

const getMemberDetail: AgentTool = {
  name: 'get_member_detail',
  description: 'Get full profile for a single member: attendance history, enrollment, payment status, and conversation history with the business.',
  input_schema: {
    type: 'object' as const,
    properties: {
      member_id: { type: 'string', description: 'The member ID to look up.' },
    },
    required: ['member_id'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const memberId = input.member_id as string

    try {
      // Fetch customer detail
      const customers = await ppGet<PPCustomerV3>(
        ctx.apiKey, `/customers/${memberId}`, {}, ctx.companyId,
      )
      const customer = Array.isArray(customers) ? customers[0] : customers

      if (!customer) return { error: `Member ${memberId} not found` }

      // Fetch checkins for this member
      const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000)
      let checkins: PPCheckin[] = []
      try {
        checkins = await ppGet<PPCheckin>(
          ctx.apiKey, '/checkins',
          { customer: memberId, timestamp_min: Math.floor(sixtyDaysAgo.getTime() / 1000).toString() },
          ctx.companyId,
        )
      } catch { /* graceful */ }

      // Fetch conversation history from tasks
      const { data: tasks } = await supabaseAdmin
        .from('agent_tasks')
        .select('id, task_type, goal, status, outcome, created_at')
        .eq('account_id', ctx.accountId)
        .or(`member_id.eq.${memberId},member_email.eq.${(customer as any).email ?? ''}`)
        .order('created_at', { ascending: false })
        .limit(5)

      // Check recent outbound messages
      const { data: recentMessages } = await supabaseAdmin
        .from('outbound_messages')
        .select('id, subject, channel, status, created_at')
        .eq('account_id', ctx.accountId)
        .eq('recipient_email', (customer as any).email ?? '')
        .order('created_at', { ascending: false })
        .limit(5)

      return {
        id: customerId(customer as PPCustomerV3),
        name: customerName(customer as PPCustomerV3),
        email: (customer as any).email ?? null,
        phone: (customer as any).phone ?? null,
        role: (customer as any).role ?? null,
        checkins_60d: checkins.length,
        recent_checkins: checkins.slice(0, 10).map(c => ({
          timestamp: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
          kind: c.kind,
        })),
        recent_tasks: tasks ?? [],
        recent_messages: recentMessages ?? [],
      }
    } catch (err: any) {
      return { error: `Failed to fetch member detail: ${err.message}` }
    }
  },
}

// ── get_open_tasks ──────────────────────────────────────────────────────

const getOpenTasks: AgentTool = {
  name: 'get_open_tasks',
  description: 'Get current open tasks for this business. Shows what\'s already being worked on.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  requiresApproval: false,
  async execute(_input: Record<string, unknown>, ctx: ToolContext) {
    try {
      const tasks = await getOpenTasksForGym(ctx.accountId)
      return {
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          type: t.task_type,
          memberName: t.member_name,
          memberEmail: t.member_email,
          goal: t.goal,
          status: t.status,
          priority: (t.context as any)?.priority ?? 'medium',
          createdAt: t.created_at,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch tasks: ${err.message}` }
    }
  },
}

// ── get_memories ────────────────────────────────────────────────────────

const getMemoriesData: AgentTool = {
  name: 'get_memories',
  description: 'Get business memories — owner preferences, member notes, learned patterns. Filter by category or member.',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (preference, member_fact, gym_context, business_stats, learned_pattern, data_lens).',
      },
      member_id: {
        type: 'string',
        description: 'Get memories specific to this member (plus global memories).',
      },
    },
    required: [],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    try {
      const memories = await getAccountMemories(ctx.accountId, {
        category: input.category as string | undefined,
        memberId: input.member_id as string | undefined,
      })
      return {
        count: memories.length,
        memories: memories.map(m => ({
          id: m.id,
          category: m.category,
          content: m.content,
          importance: m.importance,
          scope: m.scope,
          memberId: m.member_id,
          source: m.source,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch memories: ${err.message}` }
    }
  },
}

// ── get_checkins ────────────────────────────────────────────────────────

const getCheckins: AgentTool = {
  name: 'get_checkins',
  description: 'Get recent check-in activity. Filter by date range or member.',
  input_schema: {
    type: 'object' as const,
    properties: {
      member_id: { type: 'string', description: 'Filter to a specific member.' },
      days_back: { type: 'number', description: 'How many days back to look (default 30, max 90).' },
      limit: { type: 'number', description: 'Max results (default 50, max 200).' },
    },
    required: [],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const daysBack = Math.min((input.days_back as number) || 30, 90)
    const limit = Math.min((input.limit as number) || 50, 200)
    const since = new Date(Date.now() - daysBack * 86_400_000)

    try {
      const params: Record<string, string> = {
        timestamp_min: Math.floor(since.getTime() / 1000).toString(),
      }
      if (input.member_id) params.customer = input.member_id as string

      const checkins = await ppGet<PPCheckin>(ctx.apiKey, '/checkins', params, ctx.companyId)

      // Filter to valid attendee checkins
      const valid = checkins
        .filter(c => {
          if (c.role && c.role !== 'attendee') return false
          if (c.result && c.result !== 'success') return false
          return true
        })
        .slice(0, limit)

      return {
        total: valid.length,
        checkins: valid.map(c => ({
          id: c.id,
          memberId: c.customer ?? c.customerId,
          timestamp: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
          kind: c.kind,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch checkins: ${err.message}` }
    }
  },
}

// ── get_classes ──────────────────────────────────────────────────────────

const getClasses: AgentTool = {
  name: 'get_classes',
  description: 'Get class schedule and enrollment counts.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  requiresApproval: false,
  async execute(_input: Record<string, unknown>, ctx: ToolContext) {
    try {
      const classes = await ppGet<Record<string, unknown>>(ctx.apiKey, '/classes', {}, ctx.companyId)
      return {
        count: classes.length,
        classes: classes.slice(0, 50).map(c => ({
          id: (c as any).id,
          name: (c as any).name ?? (c as any).title,
          schedule: (c as any).schedule,
          capacity: (c as any).capacity,
          enrolled: (c as any).enrolled ?? (c as any).enrollmentCount,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch classes: ${err.message}` }
    }
  },
}

// ── get_data_lenses ─────────────────────────────────────────────────────

const getDataLenses: AgentTool = {
  name: 'get_data_lenses',
  description: 'Get pre-computed data lens summaries — segment-level business intelligence.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  requiresApproval: false,
  async execute(_input: Record<string, unknown>, ctx: ToolContext) {
    try {
      const { data, error } = await supabaseAdmin
        .from('memories')
        .select('id, category, content, created_at')
        .eq('account_id', ctx.accountId)
        .eq('category', 'data_lens')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) return { error: `Failed to fetch data lenses: ${error.message}` }

      return {
        count: (data ?? []).length,
        lenses: (data ?? []).map((d: any) => ({
          id: d.id,
          content: d.content,
          createdAt: d.created_at,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to fetch data lenses: ${err.message}` }
    }
  },
}

// ── Tool group ──────────────────────────────────────────────────────────

export const dataToolGroup: ToolGroup = {
  name: 'data',
  tools: [getMembers, getMemberDetail, getOpenTasks, getMemoriesData, getCheckins, getClasses, getDataLenses],
}
