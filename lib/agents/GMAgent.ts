/**
 * GMAgent — Analyst + Advisor for gym owners.
 *
 * Ingests PushPress data (attendance, payments, leads, membership changes),
 * runs analysis (churn risk, revenue pace, funnel metrics, attendance trends),
 * and surfaces prioritized insights as agent_tasks.
 *
 * The GM Agent does NOT send messages automatically — it tells the owner
 * what to do and provides draft messages as starting points.
 *
 * Dependency-injected: no hardcoded imports of supabase, claude, or resend.
 * All external calls go through AgentDeps + optional createInsightTask injected
 * at runtime (to avoid circular deps with lib/db/tasks).
 */

import { BaseAgent } from './BaseAgent'

// ── Types ─────────────────────────────────────────────────────────────────────

export type InsightType =
  | 'churn_risk'            // member attendance dropping
  | 'renewal_at_risk'       // renewal coming + attendance dropping
  | 'payment_failed'        // payment issue
  | 'lead_going_cold'       // lead hasn't converted
  | 'no_show'               // missed scheduled appointment
  | 'new_member_onboarding' // new member, check if settling in
  | 'win_back'              // cancelled member worth targeting

export interface MemberData {
  id: string
  name: string
  email: string
  phone?: string
  status: 'active' | 'cancelled' | 'paused' | 'prospect'
  membershipType: string
  memberSince: string
  lastCheckinAt?: string
  recentCheckinsCount: number      // last 30 days
  previousCheckinsCount: number    // 30-60 days ago (for trend)
  renewalDate?: string
  monthlyRevenue: number
}

export interface CheckinData {
  id: string
  customerId?: string      // PushPress field name
  memberId?: string        // internal field name
  memberEmail?: string
  checkinAt?: string
  timestamp?: number       // unix ms (from PushPress API)
  className?: string
  kind?: 'class' | 'appointment' | 'event' | 'open'
  role?: 'staff' | 'coach' | 'assistant' | 'attendee'
  result?: 'success' | 'failure'
}

export interface LeadData {
  id: string
  name: string
  email: string
  phone?: string
  createdAt: string
  lastContactAt?: string
  convertedAt?: string
  status: 'new' | 'contacted' | 'converted' | 'lost'
}

export interface PaymentEvent {
  id: string
  memberId: string
  memberName: string
  memberEmail: string
  eventType: 'payment_failed' | 'payment_recovered' | 'payment_succeeded'
  amount: number
  failedAt?: string
  recoveredAt?: string
}

export interface GymSnapshot {
  gymId: string
  gymName?: string         // optional gym display name
  members: MemberData[]
  recentCheckins: CheckinData[]
  recentLeads: LeadData[]
  paymentEvents: PaymentEvent[]
  capturedAt: string
}

export interface GymInsight {
  type: InsightType
  priority: 'critical' | 'high' | 'medium' | 'low'
  memberId?: string
  memberName?: string
  memberEmail?: string
  title: string
  detail: string
  recommendedAction: string
  estimatedImpact: string
  draftMessage?: string
}

export interface ChurnRiskScore {
  score: number         // 0.0 - 1.0
  level: 'low' | 'medium' | 'high' | 'critical'
  factors: string[]
}

export interface AnalysisResult {
  gymId: string
  insightsFound: number
  tasksCreated: number
  insights: GymInsight[]
}

export interface GymContext {
  gymId: string
  gymName: string
  ownerName?: string
}

export interface PushPressEvent {
  type: string
  data: Record<string, unknown>
}

export interface CreateInsightTaskParams {
  gymId: string
  insight: GymInsight
  causationEventId?: string
}

// Priority order for sorting
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// ── GMAgent class ─────────────────────────────────────────────────────────────

export class GMAgent extends BaseAgent {
  /**
   * Optional: inject createInsightTask at runtime to avoid circular dep.
   * Must be set before calling runAnalysis or handleEvent.
   */
  private _createInsightTask?: (params: CreateInsightTaskParams) => Promise<{ id: string }>

  setCreateInsightTask(fn: (params: CreateInsightTaskParams) => Promise<{ id: string }>) {
    this._createInsightTask = fn
  }

  // ── scoreChurnRisk ──────────────────────────────────────────────────────────

  /**
   * Score churn risk for a member based on attendance pattern.
   * Returns a score 0-1, a level, and human-readable factors.
   */
  scoreChurnRisk(member: MemberData): ChurnRiskScore {
    const factors: string[] = []
    let score = 0

    const now = new Date()

    // --- Factor 1: Days since last check-in ---
    let daysSinceCheckin: number | null = null
    if (member.lastCheckinAt) {
      const last = new Date(member.lastCheckinAt)
      daysSinceCheckin = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))

      if (daysSinceCheckin >= 14) {
        score += 0.45
        factors.push(`${daysSinceCheckin} days since last visit`)
      } else if (daysSinceCheckin >= 7) {
        score += 0.25
        factors.push(`${daysSinceCheckin} days since last visit`)
      } else if (daysSinceCheckin >= 4) {
        score += 0.10
        factors.push(`${daysSinceCheckin} days since last visit`)
      }
    } else {
      // Never checked in
      score += 0.5
      factors.push('No check-in recorded')
    }

    // --- Factor 2: Attendance trend (drop in recent vs previous) ---
    const recent = member.recentCheckinsCount
    const previous = member.previousCheckinsCount

    if (previous > 0) {
      const dropRatio = (previous - recent) / previous
      if (dropRatio >= 0.7) {
        score += 0.3
        factors.push(`Attendance dropped ${Math.round(dropRatio * 100)}% vs last month`)
      } else if (dropRatio >= 0.4) {
        score += 0.15
        factors.push(`Attendance dropped ${Math.round(dropRatio * 100)}% vs last month`)
      } else if (dropRatio >= 0.2) {
        score += 0.05
        factors.push(`Slight attendance drop vs last month`)
      }
    } else if (recent < 2) {
      score += 0.2
      factors.push('Very low recent attendance')
    }

    // --- Factor 3: Renewal proximity ---
    if (member.renewalDate) {
      const renewal = new Date(member.renewalDate)
      const daysToRenewal = Math.floor((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      if (daysToRenewal >= 0 && daysToRenewal <= 7) {
        score += 0.3
        factors.push(`Renewal in ${daysToRenewal} days`)
      } else if (daysToRenewal >= 0 && daysToRenewal <= 14) {
        score += 0.15
        factors.push(`Renewal in ${daysToRenewal} days`)
      }
    }

    // Cap at 1.0
    score = Math.min(1.0, score)

    // Determine level
    let level: ChurnRiskScore['level']
    if (score >= 0.8) {
      level = 'critical'
    } else if (score >= 0.6) {
      level = 'high'
    } else if (score >= 0.3) {
      level = 'medium'
    } else {
      level = 'low'
    }

    return { score, level, factors }
  }

  // ── analyzeGym ──────────────────────────────────────────────────────────────

  /**
   * Generate a prioritized list of insights from gym data.
   * This is the core analytical method — pure, no side effects.
   */
  analyzeGym(snapshot: GymSnapshot): GymInsight[] {
    const insights: GymInsight[] = []
    const now = new Date()

    // --- Churn risk from member attendance ---
    for (const member of snapshot.members) {
      // Only analyze active members for churn risk
      if (member.status !== 'active') continue

      // Ignore members who visited in the last 3 days
      if (member.lastCheckinAt) {
        const last = new Date(member.lastCheckinAt)
        const daysSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
        if (daysSince < 3) continue
      }

      const riskScore = this.scoreChurnRisk(member)

      // Only surface medium+ risk
      if (riskScore.level === 'low') continue

      const daysSince = member.lastCheckinAt
        ? Math.floor((now.getTime() - new Date(member.lastCheckinAt).getTime()) / (1000 * 60 * 60 * 24))
        : null

      const title = daysSince !== null
        ? `${member.name} hasn't been in ${daysSince} days`
        : `${member.name} has no check-in history`

      const detail = `Risk score ${Math.round(riskScore.score * 100)}%. ${riskScore.factors.join('. ')}.`

      insights.push({
        type: 'churn_risk',
        priority: riskScore.level,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        title,
        detail,
        recommendedAction: 'Send a personal check-in message',
        estimatedImpact: `$${member.monthlyRevenue}/mo at risk`,
      })
    }

    // --- Payment failed events ---
    for (const payment of snapshot.paymentEvents) {
      if (payment.eventType !== 'payment_failed') continue

      insights.push({
        type: 'payment_failed',
        priority: 'critical',
        memberId: payment.memberId,
        memberName: payment.memberName,
        memberEmail: payment.memberEmail,
        title: `${payment.memberName}'s payment failed`,
        detail: `Payment of $${payment.amount} failed. Member may not be aware.`,
        recommendedAction: 'Reach out to update payment method',
        estimatedImpact: `$${payment.amount} at risk`,
      })
    }

    // --- Sort by priority ---
    insights.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

    return insights
  }

  // ── runAnalysis ─────────────────────────────────────────────────────────────

  /**
   * Main analysis run — called by cron or on-demand.
   * Fetches data, runs analysis, creates agent_tasks for insights found.
   */
  async runAnalysis(gymId: string, data: GymSnapshot): Promise<AnalysisResult> {
    const insights = this.analyzeGym(data)

    let tasksCreated = 0

    for (const insight of insights) {
      try {
        if (this._createInsightTask) {
          await this._createInsightTask({ gymId, insight })
          tasksCreated++
        }
      } catch (err) {
        console.error(`[GMAgent] runAnalysis: failed to create task for ${insight.type}:`, err)
      }
    }

    return {
      gymId,
      insightsFound: insights.length,
      tasksCreated,
      insights,
    }
  }

  // ── handleEvent ─────────────────────────────────────────────────────────────

  /**
   * Handle a PushPress webhook event.
   * Reacts immediately to important events (cancellation, no-show, etc.)
   */
  async handleEvent(gymId: string, event: PushPressEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'customer.status.changed': {
          await this._handleStatusChanged(gymId, event)
          break
        }
        case 'checkin.created': {
          // Positive signal — member showed up. No task needed.
          // Could be used to clear existing churn risk scores in future.
          break
        }
        case 'appointment.noshowed':
        case 'reservation.noshowed': {
          await this._handleNoShow(gymId, event)
          break
        }
        default:
          // Unknown event types are silently ignored
          break
      }
    } catch (err) {
      console.error(`[GMAgent] handleEvent error for ${event.type}:`, err)
    }
  }

  // ── draftMessage ─────────────────────────────────────────────────────────────

  /**
   * Draft a coach-voice message for a given insight.
   * Uses deps.claude to generate the draft.
   */
  async draftMessage(insight: GymInsight, gymContext: GymContext): Promise<string> {
    const system = `You are a message drafting assistant for a gym owner. Write in a warm, personal, coach voice — not salesy or corporate. The message should feel like it's coming from a real person who knows the member.

Keep messages short (2-4 sentences). Don't use emojis unless very natural. Use first names. Be direct but caring.`

    const insightContext = [
      `Gym: ${gymContext.gymName}`,
      gymContext.ownerName ? `Owner: ${gymContext.ownerName}` : '',
      `Situation: ${insight.title}`,
      `Details: ${insight.detail}`,
      `Recommended action: ${insight.recommendedAction}`,
      insight.memberName ? `Member: ${insight.memberName}` : '',
    ].filter(Boolean).join('\n')

    const prompt = `${insightContext}

Write a short, personal message the gym owner can send to ${insight.memberName ?? 'the member'}. 
Return ONLY the message text — no subject line, no explanation, just the message.`

    const draft = await this.deps.claude.evaluate(system, prompt)
    return draft.trim()
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async _handleStatusChanged(gymId: string, event: PushPressEvent): Promise<void> {
    const data = event.data as {
      customerId?: string
      customerName?: string
      customerEmail?: string
      newStatus?: string
      previousStatus?: string
      monthlyRevenue?: number
    }

    const newStatus = data.newStatus ?? ''
    const memberName = data.customerName ?? 'Member'
    const memberEmail = data.customerEmail ?? ''
    const monthlyRevenue = data.monthlyRevenue ?? 0

    if (newStatus === 'cancelled') {
      const insight: GymInsight = {
        type: 'win_back',
        priority: 'high',
        memberId: data.customerId,
        memberName,
        memberEmail,
        title: `${memberName} just cancelled their membership`,
        detail: `${memberName} cancelled. They were paying $${monthlyRevenue}/mo. A timely personal message can win them back.`,
        recommendedAction: 'Send a personal win-back message within 24 hours',
        estimatedImpact: monthlyRevenue > 0 ? `$${monthlyRevenue}/mo recoverable` : 'Revenue at risk',
      }

      if (this._createInsightTask) {
        await this._createInsightTask({ gymId, insight })
      }
    } else if (newStatus === 'paused') {
      const insight: GymInsight = {
        type: 'churn_risk',
        priority: 'medium',
        memberId: data.customerId,
        memberName,
        memberEmail,
        title: `${memberName} paused their membership`,
        detail: `${memberName} paused. Pauses often precede full cancellation — a check-in can prevent churn.`,
        recommendedAction: 'Check in to understand the reason for pause',
        estimatedImpact: monthlyRevenue > 0 ? `$${monthlyRevenue}/mo at risk` : 'Revenue at risk',
      }

      if (this._createInsightTask) {
        await this._createInsightTask({ gymId, insight })
      }
    }
  }

  private async _handleNoShow(gymId: string, event: PushPressEvent): Promise<void> {
    const data = event.data as {
      customerId?: string
      customerName?: string
      customerEmail?: string
      appointmentType?: string
    }

    const memberName = data.customerName ?? 'Member'

    const insight: GymInsight = {
      type: 'no_show',
      priority: 'medium',
      memberId: data.customerId,
      memberName,
      memberEmail: data.customerEmail,
      title: `${memberName} no-showed their appointment`,
      detail: `${memberName} missed their scheduled session. A quick follow-up keeps them engaged.`,
      recommendedAction: 'Send a friendly check-in and offer to reschedule',
      estimatedImpact: 'Engagement at risk',
    }

    if (this._createInsightTask) {
      await this._createInsightTask({ gymId, insight })
    }
  }
}
