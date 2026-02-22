'use client'

import { useState } from 'react'

interface InstagramConnectorProps {
  initialConnected: boolean
  initialUsername: string | null
  onBack: () => void
}

const TEST_IMAGE_URL = 'https://placehold.co/1080x1080/0063FF/FFFFFF?text=GymAgents'
const TEST_CAPTION =
  'GymAgents is watching — and your members are thriving. 💪\n\n#GymAgents #FitnessAutomation #MemberRetention'

export default function InstagramConnector({
  initialConnected,
  initialUsername,
  onBack,
}: InstagramConnectorProps) {
  const [connected, setConnected] = useState(initialConnected)
  const [username, setUsername] = useState<string | null>(initialUsername)

  const [accessToken, setAccessToken] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')

  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const fieldCls =
    'w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors'
  const labelCls =
    'text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1 block'

  const handleConnect = async () => {
    if (!accessToken.trim() || !businessAccountId.trim()) {
      setError('Both fields are required.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const res = await fetch('/api/connectors/instagram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          businessAccountId: businessAccountId.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Connection failed')
      setConnected(true)
      setUsername(data.username ?? null)
      setAccessToken('')
      setBusinessAccountId('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Instagram? The agent will no longer be able to post.')) return
    setDisconnecting(true)
    setError(null)
    try {
      const res = await fetch('/api/connectors/instagram/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Disconnect failed')
      setConnected(false)
      setUsername(null)
      setTestResult(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDisconnecting(false)
    }
  }

  const handleTestPost = async () => {
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await fetch('/api/connectors/instagram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: TEST_IMAGE_URL, caption: TEST_CAPTION }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Test post failed')
      setTestResult(
        data.permalink
          ? `Posted! View it at ${data.permalink}`
          : `Posted successfully (media ID: ${data.mediaId})`
      )
    } catch (err: any) {
      setError(err.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors"
        >
          ← Connectors
        </button>
        {!connected && (
          <button
            onClick={handleConnect}
            disabled={connecting || !accessToken.trim() || !businessAccountId.trim()}
            className="text-xs font-semibold text-white px-4 py-1.5 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0063FF' }}
          >
            {connecting ? 'Connecting…' : 'Connect Instagram'}
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 px-3 py-2 border-l-2 border-red-400 bg-red-50">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Test post success */}
      {testResult && (
        <div className="mx-6 mt-4 px-3 py-2 border-l-2 bg-green-50" style={{ borderColor: '#22c55e' }}>
          <p className="text-xs text-green-700">{testResult}</p>
        </div>
      )}

      <div className="flex-1 px-6 py-6 max-w-2xl">
        {/* Page title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            {/* Instagram gradient icon */}
            <div
              className="w-5 h-5 flex items-center justify-center flex-shrink-0"
              style={{
                background:
                  'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
              }}
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">Instagram</h1>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Connect your Instagram Business account to let agents auto-post member milestones,
            retention wins, and class highlights.
          </p>
        </div>

        {connected ? (
          /* ─── Connected state ─────────────────────────────────────────── */
          <div className="space-y-6">
            {/* Status row */}
            <div className="flex items-center gap-2 py-3 px-4 border border-gray-100 bg-gray-50">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#22c55e' }}
              />
              <span className="text-sm font-medium text-gray-900">
                Connected as{' '}
                <span style={{ color: '#0063FF' }}>
                  {username ? `@${username}` : 'your account'}
                </span>
              </span>
            </div>

            {/* What the agent can do */}
            <div>
              <p className={labelCls}>Agent can now</p>
              <ul className="space-y-2">
                {[
                  'Auto-post member milestone celebrations (100 classes, 1 year, etc.)',
                  'Share monthly retention wins ("11 members kept their goals this month")',
                  'Post class highlights and gym updates',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="mt-0.5 text-gray-300">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleTestPost}
                disabled={testing}
                className="text-xs font-semibold px-4 py-2 border border-gray-200 text-gray-700 hover:border-gray-400 transition-colors disabled:opacity-50"
              >
                {testing ? 'Posting…' : 'Test post'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          /* ─── Not connected state ─────────────────────────────────────── */
          <div className="space-y-6">
            {/* Setup guide */}
            <div className="border border-gray-200 divide-y divide-gray-100">
              <div className="px-4 py-3">
                <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">
                  Setup guide
                </p>
              </div>

              {/* Step 1 */}
              <div className="px-4 py-4 flex gap-3">
                <span
                  className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  1
                </span>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Make sure you have an <strong className="text-gray-900">Instagram Business</strong> or{' '}
                  <strong className="text-gray-900">Creator</strong> account linked to a Facebook Page.
                </p>
              </div>

              {/* Step 2 */}
              <div className="px-4 py-4 flex gap-3">
                <span
                  className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  2
                </span>
                <div className="text-xs text-gray-600 leading-relaxed space-y-1">
                  <p className="font-medium text-gray-900">Get your access token</p>
                  <p>→ Go to <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#0063FF' }}>developers.facebook.com</a></p>
                  <p>→ Create an app (Business type)</p>
                  <p>→ Add <strong className="text-gray-800">Instagram Graph API</strong> product</p>
                  <p>→ Generate a long-lived token with these permissions:</p>
                  <ul className="ml-4 space-y-0.5">
                    {['instagram_basic', 'instagram_content_publish', 'pages_show_list'].map((p) => (
                      <li key={p} className="flex items-center gap-1.5">
                        <span className="text-gray-300">·</span>
                        <code className="text-xs bg-gray-100 px-1 py-0.5 text-gray-700">{p}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Step 3 */}
              <div className="px-4 py-4 flex gap-3">
                <span
                  className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  3
                </span>
                <div className="text-xs text-gray-600 leading-relaxed space-y-1">
                  <p className="font-medium text-gray-900">Get your Business Account ID</p>
                  <p>→ In Graph API Explorer, call <code className="text-xs bg-gray-100 px-1 py-0.5 text-gray-700">/me/accounts</code></p>
                  <p>→ Find your page, then call</p>
                  <p className="ml-3">
                    <code className="text-xs bg-gray-100 px-1 py-0.5 text-gray-700 break-all">
                      /&#123;page-id&#125;?fields=instagram_business_account
                    </code>
                  </p>
                  <p>→ Copy the <code className="text-xs bg-gray-100 px-1 py-0.5 text-gray-700">id</code> value</p>
                </div>
              </div>
            </div>

            {/* Input fields */}
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Access Token</label>
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className={fieldCls}
                  placeholder="EAAxxxxxxxx…"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={labelCls}>Business Account ID</label>
                <input
                  type="text"
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                  className={fieldCls}
                  placeholder="17841400000000000"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
