'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import FeedbackWidget from '@/components/FeedbackWidget'
import ErrorCapture from '@/components/ErrorCapture'

interface Agent {
  id: string
  name: string
  active?: boolean
  skill_type?: string
}

type NavSection = 'gm' | 'agents' | 'memories' | 'skills' | 'improvements' | 'integrations' | 'settings'

interface AppShellProps {
  isDemo: boolean
  isSandboxDemo: boolean
  isPreviewMode?: boolean
  accountName: string
  children: React.ReactNode
  slidePanel?: React.ReactNode
  onSlidePanelClose: () => void
  mobileTab: 'queue' | 'chat' | 'memories' | 'settings'
  onMobileTabChange: (tab: 'queue' | 'chat' | 'memories' | 'settings') => void
  activeSection?: NavSection
  onSectionChange?: (section: NavSection) => void
  // legacy — kept so callers don't need immediate updates, ignored in render
  agents?: Agent[]
  selectedAgentId?: string | null
  onSelectAgent?: (id: string) => void
  rightPanel?: React.ReactNode
  statsBar?: React.ReactNode
}

type NavItem = { id: NavSection; label: string; icon: React.ReactNode; href?: string }

/**
 * NAV_AGENTS — one entry per built agent.
 * Pattern: add a new entry here when a new agent ships.
 * Each entry is a NavSection that renders an AgentPageLayout in the main content.
 */
const NAV_AGENTS: NavItem[] = [
  {
    id: 'gm',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.5" opacity=".9"/><rect x="11" y="3" width="6" height="3" stroke="currentColor" strokeWidth="1.5" opacity=".6"/><rect x="11" y="8" width="6" height="6" stroke="currentColor" strokeWidth="1.5" opacity=".4"/><rect x="3" y="11" width="6" height="3" stroke="currentColor" strokeWidth="1.5" opacity=".6"/></svg>
    ),
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" opacity=".9"/><path d="M3.5 17c0-3.59 2.91-6.5 6.5-6.5s6.5 2.91 6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4"/></svg>
    ),
  },
]

const NAV_BOTTOM: NavItem[] = [
  {
    id: 'memories',
    label: 'Memories',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3C6.69 3 4 5.69 4 9c0 1.74.7 3.31 1.83 4.46L5 17l3.54-1.18A5.96 5.96 0 0 0 10 16c3.31 0 6-2.69 6-6s-2.69-7-6-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".8"/><path d="M7.5 9h5M7.5 11.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".5"/></svg>
    ),
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="2.5" rx=".5" fill="currentColor" opacity=".8"/><rect x="3" y="8.75" width="10" height="2.5" rx=".5" fill="currentColor" opacity=".5"/><rect x="3" y="13.5" width="7" height="2.5" rx=".5" fill="currentColor" opacity=".3"/></svg>
    ),
  },
  {
    id: 'improvements',
    label: 'Improvements',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3l1.5 4.5H16l-3.8 2.7 1.5 4.5L10 12l-3.7 2.7 1.5-4.5L4 7.5h4.5L10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity=".9"/></svg>
    ),
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M10 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".9"/></svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" fill="currentColor" opacity=".8"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/></svg>
    ),
  },
]

function NavButton({ item, isActive, onSectionChange }: {
  item: NavItem
  isActive: boolean
  onSectionChange?: (s: NavSection) => void
}) {
  const cls = 'flex items-center gap-3 px-3 mx-2 py-2.5 w-[calc(100%-16px)] text-left transition-colors hover:bg-white/5'
  const style = isActive ? { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4 } : { borderRadius: 4 }
  const inner = (
    <>
      <span className="flex-shrink-0" style={{ color: isActive ? '#ffffff' : '#6B7280' }}>{item.icon}</span>
      <span className="text-sm font-medium" style={{ color: isActive ? '#ffffff' : '#6B7280' }}>{item.label}</span>
    </>
  )
  if (item.href) return <Link href={item.href} className={cls} style={style}>{inner}</Link>
  return <button onClick={() => onSectionChange?.(item.id)} className={cls} style={style}>{inner}</button>
}

export default function AppShell({
  isDemo,
  isSandboxDemo,
  isPreviewMode = false,
  accountName,
  children,
  slidePanel,
  onSlidePanelClose,
  mobileTab,
  onMobileTabChange,
  activeSection = 'gm',
  onSectionChange,
}: AppShellProps) {
  const router = useRouter()

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: '#F8F9FB' }}>

      {/* Top bar — yellow in demo mode, dark in production */}
      <header
        className="h-12 flex items-center px-4 justify-between flex-shrink-0 z-20 border-b"
        style={{
          backgroundColor: isDemo ? '#F4FF78' : '#111827',
          borderBottomColor: isDemo ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: isDemo ? '#080808' : '#0063FF' }}
          >
            <span className="font-bold text-xs" style={{ color: isDemo ? '#F4FF78' : 'white' }}>G</span>
          </div>
          <span className="font-medium text-sm" style={{ color: isDemo ? '#080808' : 'white' }}>GymAgents</span>
          <span className="text-sm select-none" style={{ color: isDemo ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)' }}>·</span>
          <span className="text-sm truncate max-w-32" style={{ color: isDemo ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.45)' }}>{accountName}</span>
          {isDemo && (
            <span
              className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 ml-1"
              style={{ backgroundColor: '#080808', color: '#F4FF78' }}
            >
              Demo
            </span>
          )}
          {isDemo && (
            <span className="text-xs hidden sm:inline ml-2" style={{ color: 'rgba(0,0,0,0.35)' }}>
              Free · 2 min setup · No card needed
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isDemo ? (
            <>
              <Link
                href="/api/auth/logout"
                className="text-xs transition-opacity hover:opacity-60"
                style={{ color: 'rgba(0,0,0,0.4)' }}
              >
                Exit demo
              </Link>
              <Link
                href={isPreviewMode ? '/connect' : '/login'}
                className="text-xs font-semibold px-3 py-1.5 transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#080808', color: '#F4FF78' }}
              >
                Connect my gym &rarr;
              </Link>
            </>
          ) : (
            <button
              onClick={handleLogout}
              className="hidden md:block text-xs transition-colors"
              style={{ color: 'rgba(255,255,255,0.35)' }}
            >
              Log out
            </button>
          )}
        </div>
      </header>

      {/* Body row */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">

        {/* Left nav — desktop only — dark sidebar */}
        <nav data-testid="desktop-nav" className="hidden md:flex flex-col w-44 flex-shrink-0 py-3" style={{ backgroundColor: '#111827' }}>

          {/* Agents — one item per agent, using AgentPageLayout */}
          <div className="mx-4 mt-2 mb-1">
            <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#374151' }}>Agents</p>
          </div>
          {NAV_AGENTS.map(item => (
            <NavButton key={item.id} item={item} isActive={activeSection === item.id} onSectionChange={onSectionChange as any} />
          ))}

          {/* Bottom: Settings */}
          <div className="flex-1" />
          <div className="mx-4 mb-2 border-t border-white/10" />
          {NAV_BOTTOM.map(item => (
            <NavButton key={item.id} item={item} isActive={activeSection === item.id} onSectionChange={onSectionChange as any} />
          ))}
        </nav>

        {/* Main content area — children own the full layout (AgentPageLayout handles the split) */}
        <div className="flex flex-1 min-w-0 flex-col min-h-0 overflow-hidden relative">
          <main className="flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: '#F8F9FB' }}>
            {children}
          </main>

          {/* Slide panel — overlays main content on desktop */}
          {slidePanel && (
            <div className="hidden md:flex absolute inset-0 bg-white z-10 flex-col">
              <div className="h-12 border-b border-gray-100 flex items-center px-4 flex-shrink-0">
                <button
                  onClick={onSlidePanelClose}
                  className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors"
                >
                  &larr; Back
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {slidePanel}
              </div>
            </div>
          )}
        </div>

        {/* Mobile slide panel — full screen */}
        {slidePanel && (
          <div className="md:hidden fixed inset-0 z-30 bg-white overflow-y-auto flex flex-col">
            <div className="h-12 border-b border-gray-100 flex items-center px-4 flex-shrink-0">
              <button
                onClick={onSlidePanelClose}
                className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors"
              >
                &larr; Back
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {slidePanel}
            </div>
          </div>
        )}
      </div>

      {/* Bottom tab bar — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 z-20 flex flex-shrink-0">
        <button
          onClick={() => onMobileTabChange('queue')}
          className={`flex-1 py-3 text-xs text-center transition-colors ${
            mobileTab === 'queue' ? 'text-gray-900 font-medium' : 'text-gray-400'
          }`}
        >
          Review
        </button>
        <button
          onClick={() => onMobileTabChange('chat')}
          className={`flex-1 py-3 text-xs text-center transition-colors ${
            mobileTab === 'chat' ? 'text-gray-900 font-medium' : 'text-gray-400'
          }`}
        >
          GM Chat
        </button>
        <button
          onClick={() => {
            onMobileTabChange('settings')
            if (typeof window !== 'undefined') window.location.href = '/settings'
          }}
          className={`flex-1 py-3 text-xs text-center transition-colors ${
            mobileTab === 'settings' ? 'text-gray-900 font-medium' : 'text-gray-400'
          }`}
        >
          Settings
        </button>
      </nav>

      {/* Feedback widget + error capture — present on every page */}
      <FeedbackWidget />
      <ErrorCapture />
    </div>
  )
}
