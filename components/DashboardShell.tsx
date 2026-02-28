'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from './AppShell'

type NavSection = 'agents' | 'members' | 'gm' | 'retention' | 'skills' | 'connectors' | 'settings'

interface DashboardShellProps {
  children: React.ReactNode
  activeSection?: NavSection
}

/**
 * Lightweight AppShell wrapper for sub-pages (members, threads, etc.)
 * Fetches minimal dashboard data and renders the standard chrome.
 */
export default function DashboardShell({ children, activeSection = 'agents' }: DashboardShellProps) {
  const router = useRouter()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => {
        if (r.status === 401) { router.push('/login'); return null }
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then(d => { if (d) setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [router])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <p className="text-xs text-gray-400">Loading…</p>
      </div>
    )
  }

  const isDemo = !!data?.isDemo
  const accountName = data?.gym?.account_name ?? data?.gym?.name ?? 'My Gym'

  return (
    <AppShell
      isDemo={isDemo}
      isSandboxDemo={false}
      accountName={accountName}
      agents={[]}
      selectedAgentId={null}
      onSelectAgent={() => {}}
      mobileTab="queue"
      onMobileTabChange={() => {}}
      rightPanel={<div />}
      slidePanel={null}
      onSlidePanelClose={() => {}}
      activeSection={activeSection as any}
      onSectionChange={(section) => {
        if (section === 'agents') router.push('/dashboard')
        if ((section as string) === 'members') router.push('/dashboard/members')
        if (section === 'settings') router.push('/dashboard')
      }}
    >
      {children}
    </AppShell>
  )
}
