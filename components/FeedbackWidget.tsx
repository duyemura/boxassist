'use client'

import { useState, useRef, useEffect } from 'react'
import { getRecentErrorSummary } from '@/lib/feedback-errors'

type FeedbackType = 'feedback' | 'bug' | 'suggestion'

const TYPE_LABELS: { value: FeedbackType; label: string }[] = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
]

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('feedback')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      // Delay reset so close animation can play
      const t = setTimeout(() => {
        setMessage('')
        setType('feedback')
        setSubmitted(false)
      }, 200)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!message.trim() || submitting) return
    setSubmitting(true)

    try {
      const errorSummary = getRecentErrorSummary()
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message: message.trim(),
          url: window.location.href,
          metadata: {
            recentErrors: errorSummary || undefined,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          },
        }),
      })
      setSubmitted(true)
      setTimeout(() => setIsOpen(false), 1200)
    } catch {
      // Silently fail — best effort
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        data-testid="feedback-trigger"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center justify-center w-10 h-10 transition-opacity hover:opacity-80"
        style={{
          backgroundColor: '#0063FF',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
        }}
        aria-label="Send feedback"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 2C5.58 2 2 5.13 2 9c0 2.08 1.07 3.95 2.75 5.24L4 18l3.73-1.86C8.46 16.38 9.21 16.5 10 16.5c4.42 0 8-3.13 8-7s-3.58-7.5-8-7.5z"
            fill="currentColor"
            opacity="0.9"
          />
          <text x="7.5" y="12" fontSize="8" fontWeight="700" fill="#0063FF">?</text>
        </svg>
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false)
          }}
        >
          {/* Modal card */}
          <div
            data-testid="feedback-modal"
            className="w-80 border flex flex-col"
            style={{
              backgroundColor: '#fff',
              borderColor: '#E5E7EB',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#E5E7EB' }}>
              <span className="text-sm font-semibold" style={{ color: '#111827' }}>
                Send feedback
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-xs hover:opacity-80"
                style={{ color: '#9CA3AF', cursor: 'pointer', border: 'none', background: 'none' }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            {submitted ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium" style={{ color: '#111827' }}>
                  Thanks for the feedback!
                </p>
                <p className="text-xs mt-1" style={{ color: '#6B7280' }}>
                  We will review it shortly.
                </p>
              </div>
            ) : (
              <>
                {/* Type selector */}
                <div className="px-4 pt-3 flex gap-1.5">
                  {TYPE_LABELS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setType(value)}
                      className="px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: type === value ? '#0063FF' : '#F3F4F6',
                        color: type === value ? '#fff' : '#6B7280',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Message textarea */}
                <div className="px-4 pt-3 pb-2">
                  <textarea
                    ref={textareaRef}
                    data-testid="feedback-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      type === 'bug'
                        ? 'What happened? What did you expect?'
                        : type === 'suggestion'
                          ? 'What would make this better?'
                          : 'Tell us what you think...'
                    }
                    className="w-full text-sm resize-none focus:outline-none focus:border-blue-400"
                    style={{
                      border: '1px solid #E5E7EB',
                      padding: '8px 10px',
                      minHeight: '80px',
                      color: '#111827',
                      backgroundColor: '#FAFAFA',
                    }}
                    maxLength={5000}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        handleSubmit()
                      }
                    }}
                  />
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                    {message.length > 0 ? `${message.length}/5000` : 'Cmd+Enter to send'}
                  </span>
                  <button
                    data-testid="feedback-submit"
                    onClick={handleSubmit}
                    disabled={!message.trim() || submitting}
                    className="px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: message.trim() ? '#0063FF' : '#D1D5DB',
                      color: '#fff',
                      border: 'none',
                      cursor: message.trim() && !submitting ? 'pointer' : 'default',
                      opacity: submitting ? 0.6 : 1,
                    }}
                  >
                    {submitting ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
