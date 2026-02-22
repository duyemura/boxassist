import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runEventAgentWithMCP } from '@/lib/claude'
import { decrypt } from '@/lib/encrypt'

// PushPress webhook event types (canonical names from SDK)
type PPEventType =
  | 'customer.created'
  | 'customer.status.changed'
  | 'customer.details.changed'
  | 'customer.deleted'
  | 'enrollment.created'
  | 'enrollment.status.changed'
  | 'enrollment.deleted'
  | 'checkin.created'
  | 'checkin.updated'
  | 'checkin.deleted'
  | 'appointment.scheduled'
  | 'appointment.rescheduled'
  | 'appointment.canceled'
  | 'appointment.noshowed'
  | 'reservation.created'
  | 'reservation.waitlisted'
  | 'reservation.canceled'
  | 'reservation.noshowed'
  | 'class.canceled'
  | 'memberapp.updated'

interface PPWebhookPayload {
  event?: PPEventType
  type?: PPEventType           // some versions use "type"
  companyId?: string
  company_id?: string
  data?: Record<string, unknown>
  object?: Record<string, unknown>
  [key: string]: unknown
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/pushpress
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Grab raw body for potential signature verification later
  const body = await req.text()

  // Respond 200 immediately — all processing is async
  processWebhookAsync(body).catch(err =>
    console.error('[webhook] async error:', err)
  )

  return NextResponse.json({ received: true })
}

async function processWebhookAsync(rawBody: string) {
  let payload: PPWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[webhook] invalid JSON body')
    return
  }

  const eventType = (payload.event ?? payload.type ?? '') as PPEventType
  if (!eventType) {
    console.warn('[webhook] no event type in payload')
    return
  }

  const companyId = payload.companyId ?? payload.company_id ?? ''
  console.log(`[webhook] ${eventType} for company=${companyId}`)

  // Look up gym by PushPress company ID
  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id, gym_name, pushpress_api_key, pushpress_company_id')
    .eq('pushpress_company_id', companyId)
    .single()
    .catch(() => ({ data: null }))

  // Store the raw event regardless of gym match
  const { data: webhookEvent } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      gym_id: gym?.id ?? null,
      event_type: eventType,
      payload: payload as Record<string, unknown>,
      agent_runs_triggered: 0
    })
    .select('id')
    .single()
    .catch(() => ({ data: null }))

  if (!gym) {
    console.log(`[webhook] no gym for company=${companyId}, event stored`)
    return
  }

  // Decrypt the stored API key to pass to MCP
  let decryptedApiKey: string
  try {
    decryptedApiKey = decrypt(gym.pushpress_api_key)
  } catch {
    console.error('[webhook] could not decrypt API key for gym', gym.id)
    return
  }

  const gymWithKey = {
    ...gym,
    pushpress_api_key: decryptedApiKey
  }

  // Find active agent subscriptions for this event type
  const { data: subs } = await supabaseAdmin
    .from('agent_subscriptions')
    .select('id, autopilot_id, autopilots(*)')
    .eq('gym_id', gym.id)
    .eq('event_type', eventType)
    .eq('is_active', true)
    .catch(() => ({ data: [] }))

  let runsTriggered = 0
  const eventData = (payload.data ?? payload.object ?? payload) as Record<string, unknown>

  for (const sub of subs ?? []) {
    const autopilot = (sub as any).autopilots
    if (!autopilot?.is_active) continue

    try {
      await runSubscribedAgent(gymWithKey, autopilot, eventType, eventData)
      runsTriggered++
    } catch (err) {
      console.error(`[webhook] agent ${autopilot.id} failed:`, err)
    }
  }

  // Update webhook event with result count
  if (webhookEvent?.id) {
    await supabaseAdmin
      .from('webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        agent_runs_triggered: runsTriggered
      })
      .eq('id', webhookEvent.id)
      .catch(() => {})
  }

  console.log(`[webhook] ${eventType} done — ${runsTriggered} agents fired`)
}

async function runSubscribedAgent(
  gym: { id: string; gym_name: string; pushpress_api_key: string; pushpress_company_id: string },
  autopilot: { id: string; skill_type: string; name?: string; system_prompt?: string; action_type?: string },
  eventType: string,
  eventData: Record<string, unknown>
) {
  // Create agent run record
  const { data: run } = await supabaseAdmin
    .from('agent_runs')
    .insert({
      gym_id: gym.id,
      agent_type: autopilot.skill_type,
      status: 'running',
      input_summary: `Event: ${eventType}`
    })
    .select('id')
    .single()

  try {
    // Run the MCP-powered agent — it has full PushPress tool access
    const result = await runEventAgentWithMCP({
      gym,
      autopilot,
      eventType,
      eventPayload: eventData
    })

    // Store the action
    await supabaseAdmin.from('agent_actions').insert({
      agent_run_id: run!.id,
      action_type: autopilot.action_type ?? 'draft_message',
      content: result.output,
      approved: null,
      dismissed: null
    })

    // Complete the run
    await supabaseAdmin
      .from('agent_runs')
      .update({
        status: 'completed',
        output: result.output,
        input_summary: `Event: ${eventType} — ${result.toolCallCount} tool calls`
      })
      .eq('id', run!.id)

    // Update autopilot stats
    const { data: ap } = await supabaseAdmin
      .from('autopilots')
      .select('run_count')
      .eq('id', autopilot.id)
      .single()

    await supabaseAdmin
      .from('autopilots')
      .update({
        last_run_at: new Date().toISOString(),
        run_count: (ap?.run_count ?? 0) + 1
      })
      .eq('id', autopilot.id)
  } catch (err) {
    await supabaseAdmin
      .from('agent_runs')
      .update({ status: 'failed' })
      .eq('id', run!.id)
    throw err
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/webhooks/pushpress — health check + setup info
// ──────────────────────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/pushpress',
    note: 'Webhook is auto-registered when a gym connects — no manual setup needed.',
    supported_events: [
      'customer.created',
      'customer.status.changed',
      'enrollment.created',
      'enrollment.status.changed',
      'checkin.created',
      'appointment.scheduled',
      'appointment.canceled',
      'reservation.created',
      'reservation.canceled',
    ]
  })
}
