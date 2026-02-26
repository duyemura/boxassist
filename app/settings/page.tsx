'use client'

import { useState, useEffect, Suspense, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Memory types ────────────────────────────────────────────────────────────
type MemoryCategory = 'preference' | 'member_fact' | 'gym_context' | 'learned_pattern'

interface GymMemory {
  id: string
  category: MemoryCategory
  content: string
  importance: number
  scope: string
  source: string
  member_id: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: 'Preference',
  member_fact: 'Member Fact',
  gym_context: 'Gym Context',
  learned_pattern: 'Learned Pattern',
}

const CATEGORY_COLORS: Record<MemoryCategory, { color: string; bg: string }> = {
  preference: { color: '#0063FF', bg: 'rgba(0,99,255,0.08)' },
  gym_context: { color: '#16A34A', bg: 'rgba(22,163,74,0.08)' },
  member_fact: { color: '#7C3AED', bg: 'rgba(124,58,237,0.08)' },
  learned_pattern: { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
}

function ImportanceDots({ level, size = 'sm' }: { level: number; size?: 'sm' | 'md' }) {
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  return (
    <span className="inline-flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`${dotSize} rounded-full`}
          style={{ backgroundColor: i <= level ? '#111827' : '#D1D5DB' }}
        />
      ))}
    </span>
  )
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

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

  // Memory state
  const [memories, setMemories] = useState<GymMemory[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newMemory, setNewMemory] = useState({
    content: '',
    category: 'preference' as MemoryCategory,
    importance: 3,
    pinToContext: false,
  })
  const [addingMemory, setAddingMemory] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memories')
      if (res.ok) {
        const json = await res.json()
        setMemories(json.memories ?? [])
      }
    } catch {
      // ignore
    } finally {
      setMemoriesLoading(false)
    }
  }, [])

  const handleAddMemory = async () => {
    if (!newMemory.content.trim()) return
    setAddingMemory(true)
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newMemory.content.trim(),
          category: newMemory.category,
          importance: newMemory.pinToContext ? 5 : newMemory.importance,
        }),
      })
      if (res.ok) {
        setNewMemory({ content: '', category: 'preference', importance: 3, pinToContext: false })
        setShowAddModal(false)
        await fetchMemories()
      }
    } catch {
      // ignore
    } finally {
      setAddingMemory(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await fetch('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setMemories(prev => prev.filter(m => m.id !== id))
    } catch {
      // ignore
    }
  }

  const filteredMemories = memorySearch
    ? memories.filter(m => m.content.toLowerCase().includes(memorySearch.toLowerCase()))
    : memories

  useEffect(() => {
    fetchData()
    fetchGmailStatus()
    fetchMemories()
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

        {/* Agent Memories */}
        <div className="bg-white border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-gray-900">Memory Bank</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {memories.length} {memories.length === 1 ? 'memory' : 'memories'} stored
              </p>
            </div>
            {!isDemo && (
              <button
                onClick={() => setShowAddModal(true)}
                className="text-xs font-semibold text-white px-4 py-1.5 hover:opacity-80 transition-opacity"
                style={{ backgroundColor: '#0063FF' }}
              >
                + Add Memory
              </button>
            )}
          </div>

          {/* Search */}
          {memories.length > 3 && (
            <div className="mb-4">
              <input
                type="text"
                value={memorySearch}
                onChange={e => setMemorySearch(e.target.value)}
                placeholder="Search memories..."
                className="w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors"
              />
            </div>
          )}

          {/* Memory cards */}
          {memoriesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse bg-gray-100 h-20" />
              ))}
            </div>
          ) : filteredMemories.length === 0 && memories.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-200">
              <p className="text-sm text-gray-400">No memories yet.</p>
              <p className="text-xs text-gray-300 mt-1">Tell your agents what to remember — they'll use it in every conversation.</p>
              {!isDemo && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-3 text-xs font-semibold px-3 py-1.5 border transition-colors hover:opacity-80"
                  style={{ borderColor: '#0063FF', color: '#0063FF' }}
                >
                  + Add your first memory
                </button>
              )}
            </div>
          ) : filteredMemories.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No memories match "{memorySearch}"</p>
          ) : (
            <div className="space-y-2">
              {filteredMemories.map(memory => (
                <div key={memory.id} className="border border-gray-100 p-4 group hover:border-gray-200 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      {/* Category + source badges */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5"
                          style={{
                            color: CATEGORY_COLORS[memory.category]?.color ?? '#6B7280',
                            backgroundColor: CATEGORY_COLORS[memory.category]?.bg ?? '#F3F4F6',
                          }}
                        >
                          {CATEGORY_LABELS[memory.category] ?? memory.category}
                        </span>
                        {memory.source === 'agent' && (
                          <span className="text-[10px] font-medium px-2 py-0.5" style={{ color: '#6B7280', backgroundColor: '#F3F4F6' }}>
                            Agent-learned
                          </span>
                        )}
                        {memory.source === 'system' && (
                          <span className="text-[10px] font-medium px-2 py-0.5" style={{ color: '#6B7280', backgroundColor: '#F3F4F6' }}>
                            System
                          </span>
                        )}
                        {memory.importance >= 5 && (
                          <span className="text-[10px] font-medium px-2 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}>
                            Pinned
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <p className="text-sm text-gray-900">{memory.content}</p>

                      {/* Meta row */}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-[10px] text-gray-400">
                          <span className="text-[10px] text-gray-400">Importance:</span>
                          <ImportanceDots level={memory.importance} />
                        </span>
                        <span className="text-[10px] text-gray-300">{relativeTime(memory.created_at)}</span>
                        {memory.member_id && (
                          <span className="text-[10px] text-gray-300">Member: {memory.member_id.slice(0, 8)}...</span>
                        )}
                      </div>
                    </div>

                    {/* Delete */}
                    {!isDemo && (
                      <button
                        onClick={() => handleDeleteMemory(memory.id)}
                        className="text-xs text-gray-300 hover:text-red-500 transition-colors ml-3 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Memory Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white border border-gray-200 w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-900">Add Memory</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Tell your agent something to remember.</p>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-gray-400 hover:text-gray-700 transition-colors text-lg"
                >
                  &times;
                </button>
              </div>

              {/* Content */}
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">Memory Content</p>
                  <textarea
                    value={newMemory.content}
                    onChange={e => setNewMemory(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="e.g. Always sign off as Coach Dan"
                    rows={3}
                    className="w-full text-sm border border-gray-200 bg-white px-3 py-2 resize-y focus:outline-none focus:border-blue-400 transition-colors"
                  />
                </div>

                {/* Category + Importance row */}
                <div className="flex gap-4">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">Category</p>
                    <select
                      value={newMemory.category}
                      onChange={e => setNewMemory(prev => ({ ...prev, category: e.target.value as MemoryCategory }))}
                      className="w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors"
                    >
                      <option value="preference">Preference</option>
                      <option value="gym_context">Gym Context</option>
                      <option value="member_fact">Member Fact</option>
                      <option value="learned_pattern">Pattern</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">Importance</p>
                    <div className="flex items-center gap-1 py-2 px-3 border border-gray-200">
                      {[1, 2, 3, 4, 5].map(level => (
                        <button
                          key={level}
                          onClick={() => setNewMemory(prev => ({ ...prev, importance: level, pinToContext: level >= 5 }))}
                          className="w-4 h-4 rounded-full transition-colors"
                          style={{
                            backgroundColor: level <= newMemory.importance ? '#111827' : '#D1D5DB',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Pin to Context toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pin to Context</p>
                    <p className="text-xs text-gray-400">Always include in agent's prompt</p>
                  </div>
                  <button
                    onClick={() => setNewMemory(prev => ({
                      ...prev,
                      pinToContext: !prev.pinToContext,
                      importance: !prev.pinToContext ? 5 : 3,
                    }))}
                    className="relative transition-colors"
                    style={{
                      width: 44, height: 24, borderRadius: 12,
                      backgroundColor: newMemory.pinToContext ? '#0063FF' : '#D1D5DB',
                    }}
                  >
                    <span
                      className="absolute bg-white transition-transform"
                      style={{
                        top: 2, left: 2, width: 20, height: 20, borderRadius: 10,
                        transform: newMemory.pinToContext ? 'translateX(20px)' : 'translateX(0)',
                      }}
                    />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddMemory}
                    disabled={addingMemory || !newMemory.content.trim()}
                    className="text-xs font-semibold text-white px-5 py-2 hover:opacity-80 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {addingMemory ? 'Adding...' : 'Add Memory'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
