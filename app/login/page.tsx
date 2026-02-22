'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')

  const errorMessages: Record<string, string> = {
    invalid: 'That login link didn\'t work. Request a new one below.',
    expired: 'That login link expired. Request a new one — they\'re quick.',
    notfound: 'We couldn\'t find an account with that email.'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please try again.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Something went wrong — please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-700  flex items-center justify-center">
              <span className="text-white font-bold">G</span>
            </div>
            <span className="font-bold text-gray-900 text-xl">GymAgents</span>
          </Link>
          <p className="text-gray-400 mt-2 text-sm">Your gym on autopilot</p>
        </div>

        <div className="bg-white  border border-gray-200 p-8 shadow-sm">

          {errorParam && (
            <div className="bg-red-50 border border-red-100  p-3 mb-6 text-red-600 text-sm">
              {errorMessages[errorParam] ?? 'Something went wrong — please try again.'}
            </div>
          )}

          {sent ? (
            <div className="text-center">
              <div className="text-5xl mb-4">📬</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Check your inbox</h2>
              <p className="text-gray-500 text-sm mb-2">
                We sent a login link to <strong>{email}</strong>.
              </p>
              <p className="text-gray-400 text-xs mb-6">Link expires in 15 minutes. Can't find it? Check spam.</p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome back</h1>
              <p className="text-gray-400 text-sm mb-6">
                Enter your email and we'll send a link. No password needed.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-100  p-3 mb-4 text-red-600 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@yourgym.com"
                    className="w-full px-4 py-3  border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 text-gray-900 placeholder-gray-300"
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-bold py-3.5  transition-colors"
                >
                  {loading ? 'Sending…' : 'Send my login link →'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-gray-100 text-center">
                <p className="text-gray-400 text-sm">
                  New here? Just enter your email — we'll set up your account right away.
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-gray-400 text-xs mt-4">
          <Link href="/" className="hover:text-gray-600">← Back to GymAgents</Link>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading…</div></div>}>
      <LoginForm />
    </Suspense>
  )
}
