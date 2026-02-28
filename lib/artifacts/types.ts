// ============================================================
// Artifact types — rich, shareable HTML documents from agents
// ============================================================

export type ArtifactType =
  | 'research_summary'
  | 'monthly_report'
  | 'member_plan'
  | 'roi_card'

export interface Artifact {
  id: string
  account_id: string
  artifact_type: ArtifactType
  title: string
  data: Record<string, unknown>
  html: string | null
  task_id: string | null
  created_by: string
  share_token: string | null
  created_at: string
}

// ── Research Summary data shape ──────────────────────────────

export interface ResearchSummaryData {
  title?: string
  accountName: string
  generatedAt: string
  period: string                       // "February 2026" or "Last 30 days"
  generatedBy: string                  // "GM Agent"

  // Hero stats
  stats: {
    membersAtRisk: number
    membersRetained: number
    revenueRetained: number
    messagesSent: number
    conversationsActive: number
    escalations: number
  }

  // Member details
  members: Array<{
    name: string
    email?: string
    status: 'retained' | 'at_risk' | 'churned' | 'active' | 'escalated' | 'new'
    riskLevel?: 'high' | 'medium' | 'low'
    detail: string                     // what happened / what's going on
    lastCheckin?: string               // "3 days ago" or date
    membershipValue?: number
  }>

  // Insights / recommendations
  insights: string[]

  // Optional trend comparison
  trend?: {
    retainedPrev: number
    revenuePrev: number
    direction: 'up' | 'down' | 'flat'
  }
}
