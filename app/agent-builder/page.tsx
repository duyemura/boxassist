'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

interface AutopilotConfig {
  name: string
  description: string
  trigger_mode: 'event' | 'cron' | 'both'
  trigger_event: string | null
  cron_schedule: string | null
  data_sources: string[]
  action_type: string
  system_prompt: string
  estimated_value: string
  skill_type: string
}

const WHEN_LABELS: Record<string, string> = {
  'customer.created': 'the moment a new member joins',
  'customer.status.changed': "a member's status changes",
  'enrollment.created': 'a member enrolls',
  'checkin.created': 'someone checks in',
  'appointment.scheduled': 'an appointment is booked',
  'appointment.canceled': 'an appointment is canceled',
  'reservation.created': 'someone reserves a class spot',
  'reservation.canceled': 'someone cancels a reservation',
  'payment.failed': 'a payment fails',
  daily: 'every morning',
  weekly: 'every week',
  hourly: 'every hour',
}

const ACTION_LABELS: Record<string, string> = {
  draft_message: 'Draft a message for you to review',
  send_alert: 'Send you an alert',
  create_report: 'Pull together a summary',
}

const EXAMPLES = [
  'When a new lead comes in, draft a friendly reply from me right away',
  'Every morning, find members who have not been in 2 weeks and draft a check-in message',
  'When a payment fails, draft a kind heads-up to the member',
  'When someone cancels, write a genuine win-back note from me',
  'When a new member joins, send them a warm welcome from me',
  'Every Monday, give me a quick summary of how the gym is doing',
]

function BuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('id')
  const isEdit = !!editId

  const [step, setStep] = useState<'describe' | 'preview' | 'done'>('describe')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(isEdit)
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [agentName, setAgentName] = useState('')

  // Load existing agent if editing
  useEffect(() => {
    if (!editId) return
    setLoadingExisting(true)
    fetch(`/api/agent-builder/get?id=${editId}`)
      .then(r => r.json())
      .then(data => {
        if (data.config) {
          setConfig(data.config)
          setDescription(data.config.system_prompt || data.config.description || '')
          setAgentName(data.config.name || '')
          setStep('preview')
        }
      })
      .catch(() => {})
      .finally(() => setLoadingExisting(false))
  }, [editId])

  const handleNext = async () => {
    if (!description.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/agent-builder/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description })
      })

      if (res.status === 401) { router.push('/login'); return }

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please try again.')
        return
      }

      setConfig(data.config)
      setAgentName(data.config.name || '')
      setStep('preview')
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError('')

    try {
      const endpoint = isEdit ? '/api/agent-builder/update' : '/api/agent-builder/deploy'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { ...config, name: agentName || config.name }, id: editId })
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please try again.')
        return
      }

      setStep('done')
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const whenLabel = config
    ? WHEN_LABELS[config.trigger_event ?? config.cron_schedule ?? ''] ?? config.cron_schedule ?? config.trigger_event ?? ''
    : ''

  const actionLabel = config ? ACTION_LABELS[config.action_type] ?? config.action_type : ''

  if (loadingExisting) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="text-center">
          <div className="w-5 h-5 border border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }} />
          <p className="text-xs text-gray-400">Loading agent…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8F9FB' }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7  flex items-center justify-center" style={{ backgroundColor: '#0063FF' }}>
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <span className="font-medium text-gray-900 text-sm">GymAgents</span>
            <span className="text-gray-200">/</span>
            <span className="text-gray-500 text-sm">{isEdit ? 'Edit agent' : 'Create agent'}</span>
          </div>
          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Cancel
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">

        {/* Done state */}
        {step === 'done' && (
          <div className="py-16">
            <h1 className="text-lg font-semibold text-gray-900 mb-2">
              {isEdit ? 'Agent updated.' : 'Agent is running.'}
            </h1>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-medium text-gray-800">{agentName || config?.name}</span> is{' '}
              {whenLabel ? `set to run ${whenLabel}` : 'active'}.
            </p>
            <p className="text-xs text-gray-400 mb-8">
              It will bring anything important to your attention.
            </p>
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="text-sm font-semibold text-white px-4 py-2  transition-colors"
                style={{ backgroundColor: '#0063FF' }}
              >
                Back to dashboard
              </Link>
              {!isEdit && (
                <button
                  onClick={() => { setStep('describe'); setConfig(null); setDescription(''); setAgentName('') }}
                  className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2 border border-gray-200  transition-colors bg-white"
                >
                  Create another
                </button>
              )}
            </div>
          </div>
        )}

        {/* Describe step */}
        {step === 'describe' && (
          <>
            <div className="mb-8">
              <h1 className="text-lg font-semibold text-gray-900 mb-1">
                What should this agent do?
              </h1>
              <p className="text-sm text-gray-400">
                Describe it plainly. We will handle the rest.
              </p>
            </div>

            <div className="bg-white border border-gray-200  p-6">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. When a new lead comes in, draft a friendly reply from me right away"
                className="w-full h-28 px-3 py-2.5  border border-gray-200 focus:outline-none focus:border-blue-400 text-gray-900 placeholder-gray-300 text-sm resize-none"
                disabled={loading}
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleNext() }}
              />

              <div className="mt-5">
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">Examples</p>
                <div className="space-y-1">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setDescription(ex)}
                      className="text-left w-full text-xs text-gray-500 hover:text-gray-900 py-1.5 transition-colors"
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="mt-4 pl-3 border-l-2 border-red-400 text-red-600 text-xs py-1">
                  {error}
                </div>
              )}

              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs text-gray-300">Cmd+Enter to continue</span>
                <button
                  onClick={handleNext}
                  disabled={!description.trim() || loading}
                  className="text-sm font-semibold text-white px-4 py-2  disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  {loading ? 'Thinking…' : 'Continue'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Preview / Edit step */}
        {step === 'preview' && config && (
          <>
            <div className="mb-6">
              <h1 className="text-lg font-semibold text-gray-900 mb-1">
                {isEdit ? 'Edit agent' : 'Review agent'}
              </h1>
              <p className="text-sm text-gray-400">
                {isEdit ? 'Make changes and save.' : 'Review what was built. Turn it on when ready.'}
              </p>
            </div>

            {/* Current state summary — edit mode only */}
            {isEdit && (
              <div className="border-l-2 pl-4 py-1 mb-6" style={{ borderColor: '#0063FF' }}>
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Currently running as</p>
                <p className="text-sm font-medium text-gray-900">{agentName || config.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {WHEN_LABELS[config.trigger_event ?? config.cron_schedule ?? ''] 
                    ? `Runs ${WHEN_LABELS[config.trigger_event ?? config.cron_schedule ?? '']}`
                    : config.cron_schedule ?? config.trigger_event ?? 'Runs automatically'}
                  {' · '}
                  {ACTION_LABELS[config.action_type] ?? config.action_type ?? 'Takes action'}
                </p>
                {config.description && (
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{config.description}</p>
                )}
              </div>
            )}

            <div className="bg-white border border-gray-200  overflow-hidden mb-4">

              {/* Agent name — editable */}
              <div className="px-6 pt-6 pb-4 border-b border-gray-100">
                <label className="block text-xs text-gray-400 uppercase tracking-widest mb-1.5">Agent name</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  className="w-full text-base font-semibold text-gray-900 border-0 focus:outline-none focus:ring-0 p-0 bg-transparent"
                  placeholder="Untitled agent"
                />
              </div>

              <div className="px-6 py-5 space-y-5">

                {/* Description — editable */}
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">What it does</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full text-sm text-gray-700 border border-gray-200  px-3 py-2.5 resize-none focus:outline-none focus:border-blue-400"
                    rows={3}
                  />
                </div>

                {/* When */}
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">Trigger</label>
                  <p className="text-sm text-gray-700">
                    Runs {whenLabel || 'automatically'}
                  </p>
                </div>

                {/* Action */}
                <div>
                  <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">Action</label>
                  <p className="text-sm text-gray-700">
                    {actionLabel || 'Takes action based on what it finds'}
                  </p>
                </div>

                {/* Value */}
                {config.estimated_value && (
                  <div>
                    <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">Why this helps</label>
                    <p className="text-sm text-gray-600">{config.estimated_value}</p>
                  </div>
                )}

              </div>
            </div>

            {error && (
              <div className="mb-4 pl-3 border-l-2 border-red-400 text-red-600 text-xs py-1">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep('describe')}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                {isEdit ? 'Rewrite from scratch' : 'Back'}
              </button>
              <div className="flex gap-3">
                <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-700 px-4 py-2 transition-colors">
                  Cancel
                </Link>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-sm font-semibold text-white px-4 py-2  disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Turn on'}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function BuilderPage() {
  return (
    <Suspense>
      <BuilderContent />
    </Suspense>
  )
}
