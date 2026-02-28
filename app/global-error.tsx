'use client'

import { useEffect, useState } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [reported, setReported] = useState(false)

  // Auto-report error on mount
  useEffect(() => {
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'error',
        message: `[GlobalError] ${error.message}`,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        metadata: {
          stack: error.stack?.slice(0, 3000),
          digest: error.digest,
          auto: true,
          boundary: 'global',
          timestamp: new Date().toISOString(),
        },
      }),
    }).catch(() => {
      // Silently fail
    })
  }, [error])

  const handleReport = async () => {
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'bug',
          message: `[User Report] ${error.message}`,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          metadata: {
            stack: error.stack?.slice(0, 3000),
            digest: error.digest,
            userInitiated: true,
            boundary: 'global',
            timestamp: new Date().toISOString(),
          },
        }),
      })
      setReported(true)
    } catch {
      // Silently fail
    }
  }

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Something went wrong</h2>
          <p style={{ color: '#6B7280', fontSize: '0.875rem', marginBottom: '1rem' }}>{error.message}</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: '#0063FF',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={handleReport}
              disabled={reported}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: reported ? '#9CA3AF' : '#374151',
                backgroundColor: reported ? '#F3F4F6' : '#E5E7EB',
                border: 'none',
                cursor: reported ? 'default' : 'pointer',
              }}
            >
              {reported ? 'Reported — thanks!' : 'Report this issue'}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
