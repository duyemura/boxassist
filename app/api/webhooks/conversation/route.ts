export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/conversation
 *
 * Accepts inbound messages from any channel (email initially) and routes them
 * through the conversation system:
 *   1. Routes via channel-router (finds/creates conversation, adds message)
 *   2. If assigned to front_desk, runs the Front Desk agent
 *   3. Consumes session events (logs them — this is a webhook, no SSE streaming)
 *
 * This is a NEW endpoint that runs alongside the existing /api/webhooks/inbound.
 * It does NOT modify the existing flow. The two can run in parallel until
 * the conversation-based flow is fully validated and replaces the old one.
 *
 * Expected JSON body:
 * {
 *   account_id: string,
 *   channel: 'email' | 'sms' | ...,
 *   content: string,
 *   contact_id: string,
 *   contact_name?: string,
 *   contact_email?: string,
 *   contact_phone?: string,
 *   external_id?: string,
 *   subject?: string,
 *   metadata?: Record<string, unknown>
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { routeInbound } from '@/lib/channel-router'
import { handleInbound } from '@/lib/agents/front-desk'
import { escalateToGM } from '@/lib/agents/escalation'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  const { account_id, channel, content, contact_id } = body
  if (!account_id || !channel || !content || !contact_id) {
    return NextResponse.json(
      { error: 'Missing required fields: account_id, channel, content, contact_id' },
      { status: 400 },
    )
  }

  try {
    // 1. Look up account credentials for the agent session
    const { data: account, error: acctErr } = await supabaseAdmin
      .from('accounts')
      .select('id, pushpress_api_key, pushpress_company_id')
      .eq('id', account_id)
      .single()

    if (acctErr || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const apiKey = account.pushpress_api_key ? decrypt(account.pushpress_api_key) : ''
    const companyId = account.pushpress_company_id ?? ''

    // 2. Route through channel router
    const route = await routeInbound({
      accountId: account_id,
      channel,
      content,
      contactId: contact_id,
      contactName: body.contact_name,
      contactEmail: body.contact_email,
      contactPhone: body.contact_phone,
      externalId: body.external_id,
      subject: body.subject,
      metadata: body.metadata,
    })

    console.log(
      `[conversation-webhook] routed: conv=${route.conversation.id} ` +
      `isNew=${route.isNew} role=${route.assignedRole} channel=${channel}`,
    )

    // 3. Dispatch to the appropriate agent based on assigned role
    const events: Array<{ type: string; [key: string]: unknown }> = []

    if (route.assignedRole === 'front_desk') {
      // Run the Front Desk agent
      for await (const event of handleInbound(route, { apiKey, companyId })) {
        events.push(event)
        console.log(`[conversation-webhook] event: ${event.type}`)
      }
    } else if (route.assignedRole === 'gm') {
      // If conversation was already escalated to GM, run GM session
      for await (const event of escalateToGM(
        route.conversation.id,
        'Continuing escalated conversation — new inbound message',
        undefined,
        { apiKey, companyId },
      )) {
        events.push(event)
        console.log(`[conversation-webhook] gm-event: ${event.type}`)
      }
    } else {
      console.log(`[conversation-webhook] no handler for role: ${route.assignedRole}`)
    }

    const sessionEvent = events.find(e => e.type === 'session_created') as
      | { type: 'session_created'; sessionId: string }
      | undefined

    return NextResponse.json({
      ok: true,
      conversationId: route.conversation.id,
      isNew: route.isNew,
      assignedRole: route.assignedRole,
      sessionId: sessionEvent?.sessionId ?? null,
      eventsProcessed: events.length,
    })
  } catch (err: any) {
    console.error('[conversation-webhook] error:', err)
    return NextResponse.json(
      { error: `Internal error: ${err.message}` },
      { status: 500 },
    )
  }
}
