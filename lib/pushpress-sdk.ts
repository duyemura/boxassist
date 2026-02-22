/**
 * PushPress SDK utilities for GymAgents
 * 
 * The @pushpress/pushpress package ships a pre-built MCP server (bin/mcp-server.js)
 * but no compiled JS library for import. We therefore call the REST API directly
 * for server-side operations (webhook registration, messaging).
 *
 * MCP server is run as a subprocess per-agent invocation — see lib/claude.ts.
 */

const PP_BASE = 'https://api.pushpressdev.com/v3'

export interface PPClient {
  apiKey: string
  companyId: string
}

function headers(client: PPClient, extra: Record<string, string> = {}) {
  return {
    'API-KEY': client.apiKey,
    'X-Company-ID': client.companyId,
    'Content-Type': 'application/json',
    ...extra
  }
}

async function ppFetch<T>(
  client: PPClient,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${PP_BASE}${path}`, {
    ...init,
    headers: {
      ...headers(client),
      ...((init.headers as Record<string, string>) ?? {})
    }
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PushPress API ${res.status} ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ──────────────────────────────────────────────────────────────────────────────
// Webhook management
// ──────────────────────────────────────────────────────────────────────────────

export const GYMAGENTS_WEBHOOK_EVENTS = [
  'customer.created',
  'customer.status.changed',
  'enrollment.created',
  'enrollment.status.changed',
  'checkin.created',
  'appointment.scheduled',
  'appointment.canceled',
  'reservation.created',
  'reservation.canceled',
] as const

export type WebhookEventType = (typeof GYMAGENTS_WEBHOOK_EVENTS)[number]

interface PPWebhook {
  uuid: string
  url: string
  eventTypes: string[]
  active: boolean
  signingSecret?: string
}

/**
 * Register the GymAgents webhook URL with PushPress for this gym.
 * Idempotent — checks for an existing registration first.
 */
export async function registerGymAgentsWebhook(
  client: PPClient,
  webhookBaseUrl: string
): Promise<{ webhookId: string; signingSecret?: string; alreadyExisted: boolean }> {
  const targetUrl = `${webhookBaseUrl}/api/webhooks/pushpress`

  // List existing webhooks to check for duplicates
  let existing: PPWebhook[] = []
  try {
    const list = await ppFetch<{ data?: PPWebhook[] } | PPWebhook[]>(
      client, '/webhooks'
    )
    existing = Array.isArray(list) ? list : list.data ?? []
  } catch {
    existing = []
  }

  const duplicate = existing.find(w => w.url === targetUrl)
  if (duplicate) {
    // Make sure it's active
    if (!duplicate.active) {
      await ppFetch(client, `/webhooks/${duplicate.uuid}/activate`, { method: 'POST' })
    }
    return { webhookId: duplicate.uuid, alreadyExisted: true }
  }

  // Create new webhook
  const created = await ppFetch<PPWebhook>(client, '/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      url: targetUrl,
      eventTypes: GYMAGENTS_WEBHOOK_EVENTS
    })
  })

  return {
    webhookId: created.uuid,
    signingSecret: created.signingSecret,
    alreadyExisted: false
  }
}

/**
 * Deactivate the GymAgents webhook for a gym (used on disconnect).
 */
export async function deregisterGymAgentsWebhook(
  client: PPClient,
  webhookId: string
): Promise<void> {
  await ppFetch(client, `/webhooks/${webhookId}/deactivate`, { method: 'POST' })
}

// ──────────────────────────────────────────────────────────────────────────────
// Messaging via PushPress (sends as the gym, not from a third-party address)
// ──────────────────────────────────────────────────────────────────────────────

interface SendEmailParams {
  /** PushPress customer UUID */
  customerId: string
  subject: string
  text: string
  html: string
  /** Display name for From field */
  from: string
  replyTo?: string
}

interface SendSmsParams {
  /** E.164 format preferred e.g. +18005551234 */
  to: string
  message: string
}

export async function sendEmailViaPushPress(
  client: PPClient,
  params: SendEmailParams
): Promise<{ success: boolean; error?: string }> {
  try {
    await ppFetch(client, '/messages/email/send', {
      method: 'POST',
      body: JSON.stringify({
        customer: params.customerId,
        subject: params.subject,
        text: params.text,
        html: params.html,
        from: params.from,
        replyTo: params.replyTo
      })
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function sendSmsViaPushPress(
  client: PPClient,
  params: SendSmsParams
): Promise<{ success: boolean; error?: string }> {
  try {
    await ppFetch(client, '/messages/sms/send', {
      method: 'POST',
      body: JSON.stringify({ to: params.to, message: params.message })
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Customer lookup (for getting customerId to pass to email/sms)
// ──────────────────────────────────────────────────────────────────────────────

export interface PPCustomer {
  uuid: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  status?: string
}

export async function getCustomer(
  client: PPClient,
  customerId: string
): Promise<PPCustomer | null> {
  try {
    const data = await ppFetch<{ data?: PPCustomer } | PPCustomer>(
      client, `/customers/${customerId}`
    )
    return (data as any).data ?? data as PPCustomer
  } catch {
    return null
  }
}
