/**
 * lib/db/kpi.ts — KPI snapshot helpers for gym_kpi_snapshots table.
 *
 * Stores periodic snapshots of key gym metrics for trend tracking.
 * Written by cron/run-analysis after each GMAgent analysis run.
 */
import { supabaseAdmin } from '../supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KPISnapshot {
  id: string
  gymId: string
  capturedAt: string
  activeMembersCount: number | null
  churnRiskCount: number | null
  avgVisitsPerWeek: number | null
  revenueMtd: number | null
  openTasksCount: number | null
  insightsGenerated: number | null
  rawData: Record<string, unknown>
}

export interface KPISnapshotInsert {
  // Accept both camelCase variants for flexibility
  activeMembersCount?: number | null
  activeMembers?: number | null        // alias used by cron route
  churnRiskCount?: number | null
  avgVisitsPerWeek?: number | null
  revenueMtd?: number | null
  openTasksCount?: number | null
  openTasks?: number | null            // alias
  insightsGenerated?: number | null
  rawData?: Record<string, unknown>
}

// ── saveKPISnapshot ───────────────────────────────────────────────────────────

export async function saveKPISnapshot(
  gymId: string,
  snapshot: KPISnapshotInsert,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('gym_kpi_snapshots')
    .insert({
      gym_id: gymId,
      active_members: snapshot.activeMembersCount ?? null,
      churn_risk_count: snapshot.churnRiskCount ?? null,
      avg_visits_per_week: snapshot.avgVisitsPerWeek ?? null,
      revenue_mtd: snapshot.revenueMtd ?? null,
      open_tasks: snapshot.openTasksCount ?? null,
      insights_generated: snapshot.insightsGenerated ?? null,
      raw_data: snapshot.rawData ?? {},
    })

  if (error) {
    throw new Error(`saveKPISnapshot failed: ${error.message}`)
  }
}

// ── getLatestKPISnapshot ──────────────────────────────────────────────────────

export async function getLatestKPISnapshot(gymId: string): Promise<KPISnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from('gym_kpi_snapshots')
    .select('*')
    .eq('gym_id', gymId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null  // no rows
    throw new Error(`getLatestKPISnapshot failed: ${error.message}`)
  }

  if (!data) return null

  return {
    id: data.id,
    gymId: data.gym_id,
    capturedAt: data.captured_at,
    activeMembersCount: data.active_members ?? null,
    churnRiskCount: data.churn_risk_count ?? null,
    avgVisitsPerWeek: data.avg_visits_per_week ?? null,
    revenueMtd: data.revenue_mtd ?? null,
    openTasksCount: data.open_tasks ?? null,
    insightsGenerated: data.insights_generated ?? null,
    rawData: data.raw_data ?? {},
  }
}
