'use client'

export interface AnalysisProgressProps {
  steps: string[]
  isRunning: boolean
  onDismiss: () => void
}

export default function AnalysisProgress({ steps, isRunning, onDismiss }: AnalysisProgressProps) {
  return (
    <div className="flex-shrink-0 border-b border-gray-100" style={{ backgroundColor: '#F8F9FB' }}>
      <style>{`
        @keyframes ap-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header row */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        {isRunning ? (
          <span
            className="flex-shrink-0"
            style={{
              display: 'block',
              width: 11,
              height: 11,
              border: '1.5px solid #0063FF',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'ap-spin 0.75s linear infinite',
            }}
          />
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="flex-shrink-0">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="#22C55E" strokeWidth="1.4" />
            <path d="M3.2 5.5l1.6 1.6 2.8-3.2" stroke="#22C55E" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className="text-xs font-medium flex-1" style={{ color: '#111827' }}>
          {isRunning ? 'Analyzing your gym…' : 'Analysis complete'}
        </span>
        {!isRunning && (
          <button
            onClick={onDismiss}
            className="text-[10px] transition-colors hover:opacity-60"
            style={{ color: '#9CA3AF' }}
          >
            dismiss
          </button>
        )}
      </div>

      {/* Step list */}
      <div className="px-4 pb-3">
        {steps.length === 0 ? (
          <div className="flex items-center gap-2.5 py-0.5">
            <span
              style={{
                display: 'block',
                width: 7,
                height: 7,
                border: '1.5px solid #0063FF',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'ap-spin 0.75s linear infinite',
                flexShrink: 0,
              }}
            />
            <span className="text-xs" style={{ color: '#6B7280' }}>Connecting…</span>
          </div>
        ) : (
          steps.map((text, i) => {
            const isActive = isRunning && i === steps.length - 1
            return (
              <div key={i} className="flex items-start gap-2.5 py-0.5">
                {/* Icon */}
                <span className="flex-shrink-0" style={{ marginTop: 3 }}>
                  {isActive ? (
                    <span
                      style={{
                        display: 'block',
                        width: 7,
                        height: 7,
                        border: '1.5px solid #0063FF',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'ap-spin 0.75s linear infinite',
                      }}
                    />
                  ) : (
                    <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                      <circle cx="3.5" cy="3.5" r="3" stroke="#22C55E" strokeWidth="1" />
                      <path d="M2 3.5l1 1 2-2" stroke="#22C55E" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {/* Text */}
                <span
                  className="text-xs leading-relaxed"
                  style={{ color: isActive ? '#111827' : '#9CA3AF' }}
                >
                  {text}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
