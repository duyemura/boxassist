'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ConnectPage() {
  const [apiKey, setApiKey] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ gymName: string; memberCount: number } | null>(null)
  const router = useRouter()

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/gym/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, companyId })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please check your details and try again.')
      } else {
        setSuccess({ gymName: data.gymName, memberCount: data.memberCount })
        setTimeout(() => router.push('/dashboard'), 2500)
      }
    } catch {
      setError('Something went wrong — please try again.')
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white  border border-gray-200 p-10 text-center max-w-md w-full shadow-sm">
          <div className="text-5xl mb-4">🏋️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {success.gymName} is connected!
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            {success.memberCount > 0
              ? `${success.memberCount} members loaded. Your helpers are ready to go.`
              : 'Your helpers are ready to go.'}
          </p>
          <div className="flex items-center justify-center gap-2 text-blue-600">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Taking you to your dashboard…</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-700  flex items-center justify-center">
              <span className="text-white font-bold text-sm">G</span>
            </div>
            <span className="font-bold text-gray-900 text-xl">GymAgents</span>
          </Link>
        </div>

        <div className="bg-white  border border-gray-200 p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Connect your gym</h1>
          <p className="text-gray-500 text-sm mb-8">
            This takes about 2 minutes. Your login details are encrypted and never shared.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-100  p-4 mb-6 text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                PushPress API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk_..."
                className="w-full px-4 py-3  border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 font-mono text-sm text-gray-900 placeholder-gray-300"
                required
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Found in PushPress → Settings → API Access
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                PushPress Company ID
              </label>
              <input
                type="text"
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                placeholder="4a2fe9b5…"
                className="w-full px-4 py-3  border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 font-mono text-sm text-gray-900 placeholder-gray-300"
                required
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Found in PushPress → Settings → Company Info
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-bold py-4  transition-colors flex items-center justify-center gap-2 text-base"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Connecting your gym…
                </>
              ) : 'Connect my gym →'}
            </button>
          </form>

          {/* PushPress info */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <div className="bg-blue-50  p-4">
              <h3 className="font-semibold text-blue-900 text-sm mb-1">
                Don't have PushPress yet?
              </h3>
              <p className="text-blue-700 text-sm mb-3">
                GymAgents runs on your PushPress data. PushPress is free to start — most gyms are up in 20 minutes.
              </p>
              <a
                href="https://www.pushpress.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 bg-blue-700 text-white font-semibold px-4 py-2  text-sm hover:bg-blue-800 transition-colors"
              >
                Get PushPress free →
              </a>
            </div>
          </div>

          {/* Security note */}
          <p className="text-center text-xs text-gray-400 mt-5">
            🔒 Your credentials are AES-256 encrypted and never stored in plain text.
          </p>
        </div>
      </div>
    </div>
  )
}
