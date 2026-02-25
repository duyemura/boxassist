import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runEventAgentWithMCP } from '@/lib/claude'
import { decrypt } from '@/lib/encrypt'
import { GMAgent } from '@/lib/agents/GMAgent'
import { createInsightTask } from '@/lib/db/tasks'
import type { AgentDeps } from '@/lib/agents/BaseAgent'

// Minimal AgentDeps for GMAgent in webhook context (no mailer needed)
function buildWebhookAgentDeps(): AgentDeps {
  return {
    db: {
      getTask: async () => null,
      updateTaskStatus: async () => {},
      appendConversation: async () => {},
      getConversationHistory: async () => [],
      createOutboundMessage: async () => ({ id: '' } as any),
      updateOutboundMessageStatus: async () => {},
    },
    events: { publishEvent: async () => '' },
    mailer: { sendEmail: async () => ({ id: '' }) },
    claude: { evaluate: async () => '' },
  }
}

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

  // Process synchronously — DB writes are fast (<100ms) and PushPress allows up to 30s
  await processWebhookAsync(body).catch(err =>
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

  // PushPress puts company ID inside the data object, not at the top level
  // data.companyId for customers/enrollments/appointments, data.company for checkins/classes
  const eventData = (payload.data ?? payload.object ?? {}) as Record<string, unknown>
  const companyId =
    (eventData.companyId as string) ??
    (eventData.company as string) ??
    payload.companyId ??
    payload.company_id ??
    ''
  console.log(`[webhook] ${eventType} for company=${companyId}`)

  // Look up gym by PushPress company ID
  const { data: gym, error: gymErr } = await supabaseAdmin
    .from('gyms')
    .select('id, gym_name, pushpress_api_key, pushpress_company_id')
    .eq('pushpress_company_id', companyId)
    .single()

  if (gymErr) console.log(`[webhook] gym lookup: ${gymErr.message} (code=${gymErr.code})`)

  // Store the raw event regardless of gym match
  const { data: webhookEvent, error: insertErr } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      gym_id: gym?.id ?? null,
      event_type: eventType,
      payload: payload as Record<string, unknown>,
      agent_runs_triggered: 0
    })
    .select('id')
    .single()

  if (insertErr) console.error(`[webhook] insert failed: ${insertErr.message} (code=${insertErr.code})`)

  if (!gym) {
    console.log(`[webhook] no gym for company=${companyId}, event stored`)
    // Still mark as processed even when no gym matched
    if (webhookEvent?.id) {
      await supabaseAdmin
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString(), agent_runs_triggered: 0 })
        .eq('id', webhookEvent.id)
    }
    return
  }

  console.log(`[webhook] gym matched: ${gym.id} (${gym.gym_name})`)

  // Decrypt the stored API key to pass to MCP
  let decryptedApiKey: string
  try {
    decryptedApiKey = decrypt(gym.pushpress_api_key)
  } catch (err: any) {
    console.error('[webhook] could not decrypt API key for gym', gym.id, err.message)
    // Still mark as processed so we know it ran
    if (webhookEvent?.id) {
      await supabaseAdmin
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString(), agent_runs_triggered: 0 })
        .eq('id', webhookEvent.id)
    }
    return
  }

  const gymWithKey = {
    ...gym,
    pushpress_api_key: decryptedApiKey
  }

  // Find active agent subscriptions for this event type
  const { data: subs, error: subsErr } = await supabaseAdmin
    .from('agent_subscriptions')
    .select('id, autopilot_id, autopilots(*)')
    .eq('gym_id', gym.id)
    .eq('event_type', eventType)
    .eq('is_active', true)

  if (subsErr) console.log(`[webhook] subs query error: ${subsErr.message}`)
  console.log(`[webhook] found ${subs?.length ?? 0} subscriptions for ${eventType}`)

  let runsTriggered = 0
  // eventData already extracted above for companyId; reuse it for agent runs

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
    const { error: updateErr } = await supabaseAdmin
      .from('webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        agent_runs_triggered: runsTriggered
      })
      .eq('id', webhookEvent.id)
    if (updateErr) console.error(`[webhook] processed_at update failed: ${updateErr.message}`)
  }

  // ── GM Agent: react to important events immediately ─────────────────────────
  try {
    console.log(`[webhook] running GMAgent.handleEvent...`)
    const gmAgent = new GMAgent(buildWebhookAgentDeps())
    gmAgent.setCreateInsightTask(createInsightTask)
    await gmAgent.handleEvent(gym.id, {
      type: eventType,
      data: eventData,
    })
    console.log(`[webhook] GMAgent.handleEvent done`)
  } catch (err) {
    console.error('[webhook] GMAgent.handleEvent error:', err)
  }

  // ── Win-back recovery attribution ─────────────────────────────────────────
  // When a cancelled member reactivates, check for a win_back task to attribute
  if (eventType === 'customer.status.changed') {
    const newStatus = (eventData.newStatus ?? eventData.status) as string | undefined
    const previousStatus = eventData.previousStatus as string | undefined
    const customerId = (eventData.customerId ?? eventData.id) as string | undefined

    if (newStatus === 'active' && previousStatus === 'cancelled' && customerId) {
      try {
        const { data: winBackTask } = await supabaseAdmin
          .from('agent_tasks')
          .select('id, gym_id, context')
          .eq('gym_id', gym.id)
          .eq('task_type', 'win_back')
          .is('outcome', null)
          .or(`context->>memberId.eq.${customerId},member_email.eq.${eventData.customerEmail ?? ''}`)
          .limit(1)
          .single()

        if (winBackTask) {
          // Fetch gym's avg membership price for attribution
          const { data: gymData } = await supabaseAdmin
            .from('gyms')
            .select('avg_membership_price')
            .eq('id', gym.id)
            .single()

          const membershipValue = gymData?.avg_membership_price ?? 150
          const recoveryValue = membershipValue * 3

          await supabaseAdmin
            .from('agent_tasks')
            .update({
              status: 'resolved',
              outcome: 'recovered',
              outcome_reason: 'member_reactivated_after_win_back',
              outcome_score: 95,
              attributed_value: recoveryValue,
              attributed_at: new Date().toISOString(),
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', winBackTask.id)

          console.log(`[webhook] Win-back attributed! task=${winBackTask.id} value=$${recoveryValue}`)
        }
      } catch (err) {
        console.error('[webhook] win-back attribution error:', err)
      }
    }
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
