'use client'

import { useEffect } from 'react'
import { initErrorCapture } from '@/lib/feedback-errors'

/**
 * Invisible component that initializes global error capture on mount.
 * Add this to the app layout to capture window.onerror and
 * unhandledrejection events and auto-report them to /api/feedback.
 */
export default function ErrorCapture() {
  useEffect(() => {
    const cleanup = initErrorCapture()
    return cleanup
  }, [])

  return null
}
