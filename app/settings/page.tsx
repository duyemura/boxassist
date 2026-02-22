'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// Separate component so useSearchParams() is inside a Suspense boundary
function GmailBannerFromParams({ onBanner }: { onBanner: (msg: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (connected === 'gmail') onBanner('Gmail connected successfully!')
    if (error === 'gmail_auth_failed') onBanner('Gmail connection failed. Please try again.')
    if (error === 'gmail_token_failed') onBanner('Could not get Gmail token. Please try again.')
    if (error === 'no_gym') onBanner('No gym connected yet. Connect PushPress first.')
  }, [searchParams])
  return null
}

export default function SettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState('')
  const [gmailConnected, setGmailConnected] = useState<string | null>(null)
  const [gmailBanner, setGmailBanner] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
    fetchGmailStatus()
  }, [])

  const fetchData = async () => {
    const res = await fetch('/api/dashboard')
    if (res.status === 401) { router.push('/login'); return }
    const json = await res.json()
    setData(json)
    if (json.isDemo) setIsDemo(true)
    setLoading(false)
  }

  const fetchGmailStatus = async () => {
    try {
      const res = await fetch('/api/auth/gmail/status')
      if (res.ok) {
        const json = await res.json()
        setGmailConnected(json.email ?? null)
      }
    } catch {
      // ignore
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('This removes your PushPress connection and resets your helpers. Are you sure?')) return
    setDisconnecting(true)
    await fetch('/api/gym/disconnect', { method: 'POST' })
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
      body: JSON.stringify({ tier })
    })
    const { url } = await res.json()
    if (url) window.location.href = url
    setCheckoutLoading('')
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  const tierLabel = { free: 'Free', starter: 'Starter ($49/mo)', pro: 'Pro ($97/mo)' }
  const monthlyLimit = data?.tier === 'free' ? 3 : data?.tier === 'starter' ? 30 : 9999

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Read query params inside Suspense so Next.js static gen doesn't choke */}
      <Suspense fallback={null}>
        <GmailBannerFromParams onBanner={setGmailBanner} />
      </Suspense>

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-700  flex items-center justify-center">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="font-bold text-gray-900">GymAgents</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-700 text-sm">← Dashboard</Link>
            <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600 text-sm">Log out</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

        {/* Account */}
        <div className="bg-white  border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">Your account</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-sm">Email</span>
              <span className="text-gray-900 font-medium text-sm">{data?.user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-sm">Plan</span>
              <span className="text-gray-900 font-medium text-sm">{tierLabel[data?.tier as keyof typeof tierLabel]}</span>
            </div>
            {data?.user?.trial_ends_at && data?.user?.stripe_subscription_status === 'trialing' && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-sm">Trial ends</span>
                <span className="text-blue-700 font-medium text-sm">{new Date(data.user.trial_ends_at).toLocaleDateString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-sm">Scans this month</span>
              <span className="text-gray-900 font-medium text-sm">
                {data?.monthlyRunCount ?? 0} of {data?.tier === 'pro' ? 'unlimited' : monthlyLimit}
              </span>
            </div>
          </div>
        </div>

        {/* Billing */}
        <div className="bg-white  border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">Billing</h2>
          {data?.tier === 'free' ? (
            <div className="space-y-4">
              <p className="text-gray-500 text-sm">
                You're on the free plan. Upgrade to unlock more autopilots and one-tap message sending.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => handleCheckout('starter')}
                  disabled={checkoutLoading === 'starter'}
                  className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold px-5 py-3  text-sm transition-colors disabled:opacity-60"
                >
                  {checkoutLoading === 'starter' ? 'One moment…' : 'Upgrade to Starter — $49/month →'}
                </button>
                <button
                  onClick={() => handleCheckout('pro')}
                  disabled={checkoutLoading === 'pro'}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold px-5 py-3  text-sm transition-colors disabled:opacity-60"
                >
                  {checkoutLoading === 'pro' ? 'One moment…' : 'Upgrade to Pro — $97/month →'}
                </button>
              </div>
              <p className="text-gray-400 text-xs">14-day free trial on all paid plans. Cancel anytime.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-gray-500 text-sm">Change your plan, update your card, or cancel — all in one place.</p>
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-5 py-3  text-sm transition-colors disabled:opacity-60"
              >
                {portalLoading ? 'Loading…' : 'Manage billing →'}
              </button>
            </div>
          )}
        </div>

        {/* Gmail Integration */}
        <div className="bg-white border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">Integrations</h2>
          {isDemo ? (
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Gmail</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Connect your own gym to send emails from your real address.
                  </p>
                </div>
                <span className="text-xs text-gray-300 font-medium">Connect your gym first</span>
              </div>
            </div>
          ) : (
            <>
              {gmailBanner && (
                <div className={`mb-4 px-4 py-2 rounded text-sm font-medium ${gmailBanner.includes('successfully') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {gmailBanner}
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Gmail</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Send member emails from your real address. Replies come back to the agent.
                  </p>
                  {gmailConnected && (
                    <p className="text-xs mt-1" style={{ color: '#0063FF' }}>{gmailConnected}</p>
                  )}
                </div>
                {gmailConnected ? (
                  <span className="text-xs text-green-600 font-medium">Connected ✓</span>
                ) : (
                  <a
                    href="/api/auth/gmail"
                    className="text-xs font-semibold text-white px-3 py-1.5 transition-colors rounded"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    Connect Gmail
                  </a>
                )}
              </div>
            </>
          )}
        </div>

        {/* Gym connection */}
        <div className="bg-white  border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">PushPress connection</h2>
          {data?.gym ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span className="text-green-700 font-semibold text-sm">Connected</span>
              </div>
              <div className="bg-gray-50  p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Gym</span>
                  <span className="font-medium text-gray-900">{data.gym.gym_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Members</span>
                  <span className="font-medium text-gray-900">{data.gym.member_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Connected</span>
                  <span className="font-medium text-gray-900">{new Date(data.gym.connected_at).toLocaleDateString()}</span>
                </div>
                {data.gym.webhook_id && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Live updates</span>
                    <span className="text-green-600 font-medium">🟢 On</span>
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-red-500 hover:text-red-600 text-sm font-medium border border-red-100 hover:border-red-200 px-4 py-2  transition-colors"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect PushPress'}
              </button>
            </div>
          ) : (
            <div>
              <p className="text-gray-500 text-sm mb-3">No gym connected.</p>
              <Link
                href="/connect"
                className="inline-block bg-blue-700 text-white font-semibold px-5 py-2.5  text-sm hover:bg-blue-800 transition-colors"
              >
                Connect your gym →
              </Link>
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
