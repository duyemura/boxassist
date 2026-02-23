import { supabaseAdmin } from '../supabase'
import type { AgentEvent, AgentEventType, PublishEventParams } from '../types/agents'

// ============================================================
// publishEvent
// Inserts a new event into agent_events (published=false).
// Returns the new event's UUID.
// ============================================================
export async function publishEvent(params: PublishEventParams): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('agent_events')
    .insert({
      gym_id: params.gymId,
      event_type: params.eventType,
      aggregate_id: params.aggregateId,
      aggregate_type: params.aggregateType,
      payload: params.payload,
      metadata: params.metadata ?? {},
      published: false,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`publishEvent failed: ${error.message}`)
  }

  return data.id as string
}

// ============================================================
// getUnpublishedEvents
// Returns up to `limit` unpublished events ordered by created_at.
// ============================================================
export async function getUnpublishedEvents(limit: number = 100): Promise<AgentEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('agent_events')
    .select('*')
    .eq('published', false)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`getUnpublishedEvents failed: ${error.message}`)
  }

  return (data ?? []) as AgentEvent[]
}

// ============================================================
// markEventPublished
// Marks a single event as published and sets published_at.
// ============================================================
export async function markEventPublished(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_events')
    .update({
      published: true,
      published_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(`markEventPublished failed: ${error.message}`)
  }
}
