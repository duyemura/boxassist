'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface SettingsPanelProps {
  data: any
  isDemo: boolean
  gmailConnected: string | null
  onDisconnect?: () => void
}

export default function SettingsPanel({ data, isDemo, gmailConnected, onDisconnect }: SettingsPanelProps) {
  const router = useRouter()
  const [disconnecting, setDisconnecting] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState('')
  const [membershipValue, setMembershipValue] = useState(data?.gym?.avg_membership_value ?? 130)
  const [editingValue, setEditingValue] = useState(false)
  const [savingValue, setSavingValue] = useState(false)
  const [autopilotEnabled, setAutopilotEnabled] = useState(data?.gym?.autopilot_enabled ?? false)
  const [autopilotLoading, setAutopilotLoading] = useState(false)
  const [shadowModeEnd, setShadowModeEnd] = useState<string | null>(null)

  const handleToggleAutopilot = async () => {
    setAutopilotLoading(true)
    try {
      const res = await fetch('/api/settings/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autopilotEnabled }),
      })
      const result = await res.json()
      if (result.ok) {
        setAutopilotEnabled(result.autopilot_enabled)
        setShadowModeEnd(result.shadow_mode_ends ?? null)
      }
    } catch (err) {
      console.error('Failed to toggle autopilot:', err)
    }
    setAutopilotLoading(false)
  }

  const handleDisconnect = async () => {
    if (!confirm('This removes your PushPress connection and resets your agents. Are you sure?')) return
    setDisconnecting(true)
    await fetch('/api/gym/disconnect', { method: 'POST' })
    onDisconnect?.()
    router.push('/connect')
  }

  const handlePortal = async () => {
    setPortalLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.location.href = url
    setPortalLoading(false)
  }

  const handleCheckout = async (tier: string) => {
    setCheckoutLoading(tier)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    })
    const { url } = await res.json()
    if (url) window.location.href = url
    setCheckoutLoading('')
  }

  const handleSaveMembershipValue = async () => {
    setSavingValue(true)
    await fetch('/api/settings/membership-value', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: membershipValue }),
    })
    setSavingValue(false)
    setEditingValue(false)
  }

  const tierLabel: Record<string, string> = { free: 'Free', starter: 'Starter ($49/mo)', pro: 'Pro ($97/mo)' }
  const monthlyLimit = data?.tier === 'free' ? 3 : data?.tier === 'starter' ? 30 : 9999

  return (
    <div className="p-8 max-w-xl space-y-8">
      <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Settings</p>

      {/* Account */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Account</p>
        <div className="border border-gray-100 divide-y divide-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-gray-500">Email</span>
            <span className="text-xs text-gray-900 font-medium">{data?.user?.email ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-gray-500">Plan</span>
            <span className="text-xs text-gray-900 font-medium">{tierLabel[data?.tier] ?? 'Free'}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-gray-500">Scans this month</span>
            <span className="text-xs text-gray-900 font-medium">
              {data?.monthlyRunCount ?? 0} of {data?.tier === 'pro' ? 'unlimited' : monthlyLimit}
            </span>
          </div>
          {data?.user?.trial_ends_at && data?.user?.stripe_subscription_status === 'trialing' && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-gray-500">Trial ends</span>
              <span className="text-xs font-medium" style={{ color: '#0063FF' }}>
                {new Date(data.user.trial_ends_at).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ROI settings */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">ROI calculation</p>
        <div className="border border-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-xs text-gray-900 font-medium">Avg. monthly membership value</p>
              <p className="text-xs text-gray-400 mt-0.5">Used to calculate ROI per saved member</p>
            </div>
            {editingValue ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">$</span>
                <input
                  type="number"
                  value={membershipValue}
                  onChange={e => setMembershipValue(Number(e.target.value))}
                  className="w-16 text-xs border border-gray-200 px-2 py-1 text-right focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={handleSaveMembershipValue}
                  disabled={savingValue}
                  className="text-xs font-semibold px-2 py-1 text-white"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  {savingValue ? '…' : 'Save'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingValue(true)}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                ${membershipValue} <span className="underline ml-1">edit</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Autopilot Mode */}
      {!isDemo && data?.gym && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Autopilot Mode</p>
          <div className="border border-gray-100">
            <div className="flex items-start justify-between px-4 py-3">
              <div className="flex-1 mr-4">
                <p className="text-xs font-medium text-gray-900">Auto-send agent messages</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  When enabled, agents send messages without waiting for your approval. Escalations always require review.
                </p>
                {autopilotEnabled && shadowModeEnd && new Date(shadowModeEnd) > new Date() && (
                  <p className="text-xs mt-1.5" style={{ color: '#0063FF' }}>
                    Shadow mode active until {new Date(shadowModeEnd).toLocaleDateString()} — messages still require approval while you build trust.
                  </p>
                )}
                {autopilotEnabled && (!shadowModeEnd || new Date(shadowModeEnd) <= new Date()) && (
                  <p className="text-xs text-green-600 mt-1.5">
                    Active — agents are sending up to 10 messages per day automatically.
                  </p>
                )}
              </div>
              <button
                onClick={handleToggleAutopilot}
                disabled={autopilotLoading}
                className="relative inline-flex h-5 w-9 shrink-0 items-center transition-colors disabled:opacity-50"
                style={{ backgroundColor: autopilotEnabled ? '#0063FF' : '#D1D5DB' }}
              >
                <span
                  className="inline-block h-3.5 w-3.5 bg-white transition-transform"
                  style={{ transform: autopilotEnabled ? 'translateX(16px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Integrations */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Integrations</p>
        <div className="border border-gray-100 divide-y divide-gray-100">
          {/* PushPress */}
          <div className="flex items-start justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-gray-900">PushPress</p>
              {data?.gym ? (
                <p className="text-xs text-gray-400 mt-0.5">{data.gym.gym_name} · {data.gym.member_count} members</p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">Not connected</p>
              )}
            </div>
            {data?.gym ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <Link href="/connect" className="text-xs font-semibold underline" style={{ color: '#0063FF' }}>Connect</Link>
            )}
          </div>

          {/* Gmail */}
          <div className="flex items-start justify-between px-4 py-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Gmail</p>
              {isDemo ? (
                <p className="text-xs text-gray-400 mt-0.5">Connect your own gym to enable</p>
              ) : gmailConnected ? (
                <p className="text-xs mt-0.5" style={{ color: '#0063FF' }}>{gmailConnected}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">Send emails from your real address</p>
              )}
            </div>
            {isDemo ? (
              <span className="text-xs text-gray-300">Demo only</span>
            ) : gmailConnected ? (
              <span className="text-xs text-green-600 font-medium">Connected</span>
            ) : (
              <a
                href="/api/auth/gmail"
                className="text-xs font-semibold text-white px-2 py-1 transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#0063FF' }}
              >
                Connect
              </a>
            )}
          </div>

          {/* SMS */}
          <div className="flex items-start justify-between px-4 py-3 opacity-40">
            <div>
              <p className="text-xs font-medium text-gray-900">SMS</p>
              <p className="text-xs text-gray-400 mt-0.5">Text members directly from the agent</p>
            </div>
            <span className="text-xs text-gray-300">Soon</span>
          </div>
        </div>
      </section>

      {/* Billing */}
      {!isDemo && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Billing</p>
          <div className="border border-gray-100 p-4">
            {data?.tier === 'free' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">You're on the free plan. Upgrade to unlock more agents and unlimited sending.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCheckout('starter')}
                    disabled={checkoutLoading === 'starter'}
                    className="text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {checkoutLoading === 'starter' ? '…' : 'Starter — $49/mo'}
                  </button>
                  <button
                    onClick={() => handleCheckout('pro')}
                    disabled={checkoutLoading === 'pro'}
                    className="text-xs font-semibold text-white px-4 py-2 bg-gray-900 transition-colors disabled:opacity-60"
                  >
                    {checkoutLoading === 'pro' ? '…' : 'Pro — $97/mo'}
                  </button>
                </div>
                <p className="text-xs text-gray-300">14-day free trial. Cancel anytime.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Update payment, change plan, or cancel.</p>
                <button
                  onClick={handlePortal}
                  disabled={portalLoading}
                  className="text-xs font-semibold text-white px-4 py-2 bg-gray-900 transition-colors disabled:opacity-60"
                >
                  {portalLoading ? 'Loading…' : 'Manage billing →'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
