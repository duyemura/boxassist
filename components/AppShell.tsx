'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

interface Agent {
  id: string
  name: string
  active?: boolean
  skill_type?: string
}

type NavSection = 'agents' | 'skills' | 'connectors' | 'settings'

interface AppShellProps {
  isDemo: boolean
  isSandboxDemo: boolean
  gymName: string
  agents: Agent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  children: React.ReactNode       // center content
  rightPanel: React.ReactNode
  statsBar?: React.ReactNode      // spans center + right, sits above both
  slidePanel?: React.ReactNode    // null = closed
  onSlidePanelClose: () => void
  mobileTab: 'agents' | 'attention' | 'settings'
  onMobileTabChange: (tab: 'agents' | 'attention' | 'settings') => void
  activeSection?: NavSection
  onSectionChange?: (section: NavSection) => void
}

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ReactNode; href?: string }[] = [
  {
    id: 'agents',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="6" height="6" rx="1" fill="currentColor" opacity=".9"/><rect x="11" y="3" width="6" height="6" rx="1" fill="currentColor" opacity=".4"/><rect x="3" y="11" width="6" height="6" rx="1" fill="currentColor" opacity=".4"/><rect x="11" y="11" width="6" height="6" rx="1" fill="currentColor" opacity=".2"/></svg>
    ),
  },
  {
    id: 'skills',
    label: 'Playbooks',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L12.5 7.5H18L13.5 11L15.5 17L10 13.5L4.5 17L6.5 11L2 7.5H7.5L10 2Z" fill="currentColor" opacity=".8"/></svg>
    ),
  },
  {
    id: 'connectors',
    label: 'Connectors',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="5" cy="10" r="3" fill="currentColor" opacity=".6"/><circle cx="15" cy="10" r="3" fill="currentColor" opacity=".6"/><path d="M8 10H12" stroke="currentColor" strokeWidth="1.5" opacity=".6"/><circle cx="5" cy="10" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/></svg>
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

// Extra nav links (non-section, full page)
const EXTRA_NAV_LINKS = [
  {
    label: 'Threads',
    href: '/threads',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 5h14M3 10h10M3 15h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7"/>
        <circle cx="16" cy="15" r="2.5" fill="currentColor" opacity=".5"/>
      </svg>
    ),
  },
]

export default function AppShell({
  isDemo,
  isSandboxDemo,
  gymName,
  agents,
  selectedAgentId,
  onSelectAgent,
  children,
  rightPanel,
  statsBar,
  slidePanel,
  onSlidePanelClose,
  mobileTab,
  onMobileTabChange,
  activeSection = 'agents',
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
          <span className="text-sm truncate max-w-32" style={{ color: isDemo ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.45)' }}>{gymName}</span>
          {isDemo && (
            <span
              className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 ml-1"
              style={{ backgroundColor: '#080808', color: '#F4FF78' }}
            >
              Demo
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {isDemo ? (
            <>
              <span className="text-xs" style={{ color: 'rgba(0,0,0,0.4)' }}>
                Exploring PushPress East — live data
              </span>
              <Link
                href="/login"
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
        <nav className="hidden md:flex flex-col w-48 flex-shrink-0 py-3" style={{ backgroundColor: '#111827' }}>
          {NAV_ITEMS.map(item => {
            const isActive = activeSection === item.id
            const inner = (
              <>
                <span className="flex-shrink-0" style={{ color: isActive ? '#ffffff' : '#6B7280' }}>
                  {item.icon}
                </span>
                <span className="text-sm font-medium" style={{ color: isActive ? '#ffffff' : '#6B7280' }}>
                  {item.label}
                </span>
              </>
            )
            const cls = `flex items-center gap-3 px-3 mx-2 py-2.5 w-[calc(100%-16px)] text-left transition-colors`
            const style = isActive
              ? { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4 }
              : undefined
            const hoverCls = `hover:bg-white/5`

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange?.(item.id)}
                className={`${cls} ${hoverCls}`}
                style={style}
              >
                {inner}
              </button>
            )
          })}

          {/* Divider + extra links */}
          <div className="mx-4 my-2 border-t border-white/10" />
          {EXTRA_NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 px-3 mx-2 py-2.5 w-[calc(100%-16px)] hover:bg-white/5 transition-colors"
              style={{ borderRadius: 4 }}
            >
              <span className="flex-shrink-0" style={{ color: '#6B7280' }}>{link.icon}</span>
              <span className="text-sm font-medium" style={{ color: '#6B7280' }}>{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* Center + Right — stacked vertically so statsBar spans both */}
        <div className="flex flex-1 min-w-0 flex-col min-h-0 overflow-hidden">
          {/* Stats bar — spans full width of center+right */}
          {statsBar && (
            <div className="hidden md:block flex-shrink-0">
              {statsBar}
            </div>
          )}

          {/* Center + Right row */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Center column — light bg, clear contrast from dark nav */}
        <main className="flex-1 min-w-0 overflow-y-auto" style={{ backgroundColor: '#F8F9FB' }}>
          {/* Mobile: show either agent list (children) or attention tab */}
          <div className="md:hidden">
            {children}
          </div>
          {/* Desktop: always show center */}
          <div className="hidden md:block h-full overflow-y-auto">
            {children}
          </div>
        </main>

        {/* Right panel — desktop only */}
        <aside className="hidden md:flex flex-col w-96 border-l border-gray-100 bg-white overflow-y-auto flex-shrink-0 relative">
          {rightPanel}

          {/* Slide panel — overlays right panel on desktop */}
          {slidePanel && (
            <div className="absolute inset-0 bg-white z-10 overflow-y-auto flex flex-col">
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
        </aside>

          </div>{/* end center+right row */}
        </div>{/* end center+right column */}

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
          onClick={() => onMobileTabChange('agents')}
          className={`flex-1 py-3 text-xs text-center transition-colors ${
            mobileTab === 'agents' ? 'text-gray-900 font-medium' : 'text-gray-400'
          }`}
        >
          Agents
        </button>
        <button
          onClick={() => onMobileTabChange('attention')}
          className={`flex-1 py-3 text-xs text-center transition-colors ${
            mobileTab === 'attention' ? 'text-gray-900 font-medium' : 'text-gray-400'
          }`}
        >
          Attention
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
    </div>
  )
}
