'use client'

/**
 * IntegrationsPanel — connect and manage third-party integrations.
 *
 * Renders a featured section (Slack, Gmail, Twilio) plus a catalog grid.
 * OAuth: redirect flow. API key: inline form.
 */

import { useState, useEffect, useCallback } from 'react'
import { INTEGRATIONS, getFeaturedIntegrations, type IntegrationDef } from '@/lib/integrations/registry'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConnectedIntegration {
  integrationId: string
  connectedAt: string
  metadata: Record<string, unknown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className="text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5"
      style={{
        backgroundColor: connected ? 'rgba(0,99,255,0.08)' : 'rgba(107,114,128,0.08)',
        color: connected ? '#0063FF' : '#9CA3AF',
      }}
    >
      {connected ? 'Connected' : 'Not connected'}
    </span>
  )
}

interface ApiKeyFormProps {
  integration: IntegrationDef
  onConnect: (credentials: Record<string, string>) => Promise<void>
  onCancel: () => void
  loading: boolean
  error: string | null
}

function ApiKeyForm({ integration, onConnect, onCancel, loading, error }: ApiKeyFormProps) {
  const fields = integration.apiKeyFields ?? []
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, '']))
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Validate required fields
    for (const field of fields) {
      if (field.required !== false && !values[field.key]) return
    }
    await onConnect(values)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      {fields.map(field => (
        <div key={field.key}>
          <label className="block text-[10px] font-semibold tracking-widest uppercase text-gray-500 mb-1">
            {field.label}
          </label>
          <input
            type={field.secret ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key]}
            onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
            required={field.required !== false}
            className="w-full px-3 py-2 text-sm border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400"
            autoComplete="off"
          />
          {field.helpText && (
            <p className="text-[10px] text-gray-400 mt-1">{field.helpText}</p>
          )}
        </div>
      ))}

      {error && (
        <p className="text-xs text-red-500 py-1">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: '#0063FF' }}
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

interface IntegrationCardProps {
  integration: IntegrationDef
  connected: ConnectedIntegration | undefined
  onConnect: (id: string, credentials?: Record<string, string>) => Promise<void>
  onDisconnect: (id: string) => Promise<void>
}

function IntegrationCard({ integration, connected, onConnect, onDisconnect }: IntegrationCardProps) {
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnectClick = () => {
    if (integration.authType === 'oauth') {
      setLoading(true)
      onConnect(integration.id).finally(() => setLoading(false))
    } else {
      setShowForm(true)
    }
  }

  const handleApiKeyConnect = async (credentials: Record<string, string>) => {
    setLoading(true)
    setError(null)
    try {
      await onConnect(integration.id, credentials)
      setShowForm(false)
    } catch (err: any) {
      setError(err.message ?? 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect ${integration.name}?`)) return
    setLoading(true)
    try {
      await onDisconnect(integration.id)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-gray-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">{integration.iconEmoji}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900">{integration.name}</h3>
              <StatusBadge connected={!!connected} />
            </div>
            <p className="text-xs text-gray-400 mt-0.5 leading-snug max-w-xs">{integration.description}</p>
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {connected ? (
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-red-500 px-3 py-1.5 border border-gray-200 hover:border-red-200 transition-colors disabled:opacity-50"
            >
              {loading ? '…' : 'Disconnect'}
            </button>
          ) : (
            !showForm && (
              <button
                onClick={handleConnectClick}
                disabled={loading}
                className="text-xs font-semibold text-white px-3 py-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: '#0063FF' }}
              >
                {loading ? 'Redirecting…' : integration.authType === 'oauth' ? 'Connect →' : 'Set up'}
              </button>
            )
          )}
        </div>
      </div>

      {connected && (
        <p className="text-[10px] text-gray-400 mt-3">
          Connected {formatDate(connected.connectedAt)}
          {connected.metadata?.from_number && (
            <span className="ml-2 text-gray-500">· From: {connected.metadata.from_number as string}</span>
          )}
        </p>
      )}

      {showForm && !connected && (
        <ApiKeyForm
          integration={integration}
          onConnect={handleApiKeyConnect}
          onCancel={() => { setShowForm(false); setError(null) }}
          loading={loading}
          error={error}
        />
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [connected, setConnected] = useState<ConnectedIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const featured = getFeaturedIntegrations()
  const catalog = INTEGRATIONS.filter(i => !i.featured)

  const loadConnected = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      if (res.ok) {
        const json = await res.json()
        setConnected(json.integrations ?? [])
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConnected()

    // Handle ?connected= or ?error= from OAuth callback redirect
    const params = new URLSearchParams(window.location.search)
    const connectedId = params.get('connected')
    const errorMsg = params.get('error')

    if (connectedId) {
      setFlash({ type: 'success', message: `${connectedId} connected successfully.` })
      // Clean query params, keep the path (/dashboard/integrations)
      const url = new URL(window.location.href)
      url.searchParams.delete('connected')
      window.history.replaceState({}, '', url.toString())
    } else if (errorMsg) {
      setFlash({ type: 'error', message: decodeURIComponent(errorMsg) })
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [loadConnected])

  // Auto-dismiss flash
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(t)
  }, [flash])

  const handleConnect = async (id: string, credentials?: Record<string, string>) => {
    try {
      const res = await fetch(`/api/integrations/${id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials ? { credentials } : {}),
      })
      const json = await res.json()

      if (!res.ok) {
        setFlash({ type: 'error', message: json.error ?? 'Connection failed' })
        return
      }

      if (json.redirectUrl) {
        // OAuth: redirect user to provider
        window.location.href = json.redirectUrl
        return
      }

      // API key: success — reload
      setFlash({ type: 'success', message: `Connected successfully.` })
      await loadConnected()
    } catch (err: any) {
      setFlash({ type: 'error', message: err.message ?? 'Connection failed' })
    }
  }

  const handleDisconnect = async (id: string) => {
    const res = await fetch(`/api/integrations/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setFlash({ type: 'error', message: json.error ?? 'Disconnect failed' })
      return
    }
    setFlash({ type: 'success', message: `Disconnected.` })
    setConnected(prev => prev.filter(c => c.integrationId !== id))
  }

  const connectedMap = Object.fromEntries(connected.map(c => [c.integrationId, c]))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Integrations</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Connect your tools so agents can send messages, emails, and texts.
        </p>
      </div>

      {/* Flash */}
      {flash && (
        <div
          className="mx-6 mt-4 px-4 py-2.5 text-sm flex-shrink-0"
          style={{
            backgroundColor: flash.type === 'success' ? 'rgba(0,99,255,0.06)' : 'rgba(239,68,68,0.06)',
            borderLeft: `3px solid ${flash.type === 'success' ? '#0063FF' : '#EF4444'}`,
            color: flash.type === 'success' ? '#0063FF' : '#EF4444',
          }}
        >
          {flash.message}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }}
            />
          </div>
        ) : (
          <>
            {/* Featured */}
            <section>
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">Featured</p>
              <div className="space-y-3">
                {featured.map(integration => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    connected={connectedMap[integration.id]}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                  />
                ))}
              </div>
            </section>

            {/* Catalog */}
            {catalog.length > 0 && (
              <section>
                <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">More integrations</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {catalog.map(integration => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      connected={connectedMap[integration.id]}
                      onConnect={handleConnect}
                      onDisconnect={handleDisconnect}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
