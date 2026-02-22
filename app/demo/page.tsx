'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function DemoGatePage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/demo/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })

      if (!res.ok) {
        setError('Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      window.location.href = '/dashboard'
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F9FB' }}>
      {/* Minimal nav */}
      <nav className="border-b border-gray-100 bg-white px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0063FF' }}>
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <span className="font-medium text-gray-900 text-sm">GymAgents</span>
          </Link>
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Connect my gym →
          </Link>
        </div>
      </nav>

      {/* Gate form */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          {/* Headline */}
          <div className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-4">Live demo</p>
            <h1 className="text-2xl font-semibold text-gray-900 leading-tight tracking-tight mb-3">
              See GymAgents flag you as at-risk.
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              You&apos;ll appear as a member in a demo gym. The agent finds you, drafts a message, and sends it to your inbox — so you feel exactly what your members feel.
            </p>
          </div>

          {/* Form — name + email */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alex Johnson"
                autoFocus
                required
                className="w-full px-3 py-2.5 border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ borderRadius: 2 } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="email">
                Your email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="alex@example.com"
                required
                className="w-full px-3 py-2.5 border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ borderRadius: 2 } as React.CSSProperties}
              />
              <p className="text-xs text-gray-400 mt-1">We&apos;ll send you the message the agent drafted — you can edit it before it goes.</p>
            </div>

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim() || !email.trim()}
              className="w-full font-semibold px-4 py-3 text-sm text-white transition-colors disabled:opacity-50 mt-1"
              style={{ backgroundColor: '#0063FF', borderRadius: 2 }}
            >
              {loading ? 'Starting demo…' : 'Enter the demo →'}
            </button>
          </form>

          <p className="text-xs text-gray-400 mt-4 text-center">
            One email. No spam. No account needed.
          </p>

          {/* Context strip */}
          <div className="mt-10 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-400 leading-relaxed">
              You&apos;ll enter the dashboard as a &ldquo;member&rdquo; of a demo gym. When the agent sends you a check-in email, it arrives in your real inbox — so you feel exactly what your members feel.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
