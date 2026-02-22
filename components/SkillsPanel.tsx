'use client'
import { useState, useEffect } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  retention: 'Retention',
  growth: 'Growth',
  billing: 'Billing',
}

const CATEGORY_COLORS: Record<string, string> = {
  retention: '#080808',
  growth: '#080808',
  billing: '#080808',
}

// Category display order
const CATEGORY_ORDER = ['retention', 'growth', 'billing']

// ─── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  id: string
  slug: string
  name: string
  description: string
  category: string
  trigger_condition: string
  is_system: boolean
  is_active: boolean
  default_value_usd: number
  gym_id?: string | null
  system_prompt?: string
  tone_guidance?: string
  escalation_rules?: string
  success_criteria?: string
  followup_cadence?: string
  automation_level?: string
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_SKILLS: Skill[] = [
  {
    id: 'demo-at-risk',
    slug: 'at-risk-early-warning',
    name: 'At-Risk Early Warning',
    description: 'Detects members showing early signs of drifting and sends a warm, coach-style check-in before they mentally cancel.',
    category: 'retention',
    trigger_condition: "When a member's check-in frequency drops 40% or more compared to their personal 30-day average, or when they miss two or more sessions they previously attended on a consistent schedule, and there is no active vacation hold, medical note, or freeze on their account.",
    is_system: true,
    is_active: true,
    default_value_usd: 130,
    automation_level: 'draft_only',
    gym_id: null,
  },
  {
    id: 'demo-lapsed',
    slug: 'lapsed-member-win-back',
    name: 'Lapsed Member Win-Back',
    description: 'Re-engages members who have been absent for 21 or more days with an honest, no-guilt outreach that gives them an easy path back.',
    category: 'retention',
    trigger_condition: "When a member has not checked in for 21 consecutive days or more, and they are still on an active or recently expired membership (within the last 60 days), and they have not previously received a win-back message in the last 90 days, and there is no freeze, hold, or cancellation request on their account.",
    is_system: true,
    is_active: true,
    default_value_usd: 390,
    automation_level: 'draft_only',
    gym_id: null,
  },
  {
    id: 'demo-renewal',
    slug: 'renewal-at-risk',
    name: 'Renewal At-Risk',
    description: 'Reaches out to members whose membership expires within 14 days and who are showing signs they may not renew.',
    category: 'retention',
    trigger_condition: "When a member's membership is set to expire within 14 days, and their attendance has declined by 30% or more over the past 30 days compared to the prior 30-day period, and they have not already started a renewal conversation or submitted a renewal payment, and there is no hold or freeze on their account.",
    is_system: true,
    is_active: true,
    default_value_usd: 130,
    automation_level: 'draft_only',
    gym_id: null,
  },
  {
    id: 'demo-onboarding',
    slug: 'new-member-onboarding',
    name: 'New Member Onboarding',
    description: 'Builds habit and connection in the critical first 30 days with carefully timed touchpoints that help new members feel welcome and confident.',
    category: 'retention',
    trigger_condition: "When a new membership is created or activated in the system, and the member has completed their first check-in, the onboarding sequence begins. Four messages are sent at day 3, day 7, day 14, and day 30 — but only if the member has not already received each message, and only if they are still active (not cancelled or frozen).",
    is_system: true,
    is_active: true,
    default_value_usd: 390,
    automation_level: 'draft_only',
    gym_id: null,
  },
  {
    id: 'demo-lead',
    slug: 'new-lead-response',
    name: 'New Lead Response',
    description: 'Responds to new membership inquiries within minutes and guides interested prospects toward booking a trial class or intro session.',
    category: 'growth',
    trigger_condition: "When a new lead inquiry is submitted through any connected channel — a website contact form, an Instagram DM, a PushPress lead form, or a direct email to the gym's inquiry address — and the lead has not previously been marked as a member or existing contact in the system.",
    is_system: true,
    is_active: true,
    default_value_usd: 260,
    automation_level: 'smart',
    gym_id: null,
  },
  {
    id: 'demo-referral',
    slug: 'milestone-referral',
    name: 'Milestone Referral',
    description: 'Asks engaged, happy members for a referral at the moment of peak satisfaction — right after they hit a meaningful milestone.',
    category: 'growth',
    trigger_condition: "When a member hits a personal milestone — their 10th, 25th, 50th, or 100th session, their one-month, six-month, or one-year membership anniversary, or completes a program or challenge — and they have no recent complaints, holds, or billing issues on their account, and they have not been asked for a referral in the past 90 days.",
    is_system: true,
    is_active: true,
    default_value_usd: 260,
    automation_level: 'draft_only',
    gym_id: null,
  },
  {
    id: 'demo-payment',
    slug: 'failed-payment-recovery',
    name: 'Failed Payment Recovery',
    description: 'Recovers failed membership payments with a friendly, practical message that assumes good faith and gives the member an easy path to fix it.',
    category: 'billing',
    trigger_condition: "When a payment failure webhook is received from PushPress or the connected payment processor, and the member has an active or recently active membership, and no manual payment resolution is already in progress. The first message fires within 2 hours of the failure. A second message fires 3 days later if payment remains unresolved. A third message fires 7 days after the first, then the case is handed to the owner.",
    is_system: true,
    is_active: true,
    default_value_usd: 0,
    automation_level: 'draft_only',
    gym_id: null,
  },
]

// ─── Skill Detail Panel ───────────────────────────────────────────────────────

function SkillDetail({
  skill,
  isDemo,
  onClone,
  onDelete,
  onClose,
}: {
  skill: Skill
  isDemo: boolean
  onClone: () => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [cloning, setCloning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cloned, setCloned] = useState(false)

  const isSystemSkill = skill.is_system && !skill.gym_id
  const isCustom = !!skill.gym_id

  const handleClone = async () => {
    setCloning(true)
    await onClone()
    setCloned(true)
    setCloning(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${skill.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await onDelete()
    setDeleting(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: CATEGORY_COLORS[skill.category] ?? '#6E7783' }}
            >
              {CATEGORY_LABELS[skill.category] ?? skill.category}
            </span>
            {isSystemSkill && (
              <span className="text-[10px] text-gray-300">system</span>
            )}
            {isCustom && (
              <span className="text-[10px] font-medium" style={{ color: '#0063FF' }}>custom</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-gray-500 text-xs flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="text-sm font-semibold text-gray-900 leading-snug">{skill.name}</p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{skill.description}</p>
      </div>

      {/* Details */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {skill.trigger_condition && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-300 mb-1">Trigger</p>
            <p className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1.5 rounded">{skill.trigger_condition}</p>
          </div>
        )}

        {skill.system_prompt && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-300 mb-1">Agent Instructions</p>
            <p className="text-xs text-gray-600 leading-relaxed">{skill.system_prompt}</p>
          </div>
        )}

        {skill.escalation_rules && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-300 mb-1">Escalation</p>
            <p className="text-xs text-gray-500 leading-relaxed">{skill.escalation_rules}</p>
          </div>
        )}

        {skill.success_criteria && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-300 mb-1">Success</p>
            <p className="text-xs text-gray-500 leading-relaxed">{skill.success_criteria}</p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-300 mb-1">Est. value / save</p>
          <p className="text-xs text-gray-700 font-medium">
            {skill.default_value_usd > 0 ? `$${skill.default_value_usd} per member saved` : 'Included'}
          </p>
        </div>
      </div>

      {/* Actions */}
      {!isDemo && (
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          {isSystemSkill && !cloned && (
            <button
              onClick={handleClone}
              disabled={cloning}
              className="w-full text-xs font-semibold text-white py-2 transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: '#0063FF' }}
            >
              {cloning ? 'Cloning…' : 'Clone & customize'}
            </button>
          )}
          {(isSystemSkill && cloned) && (
            <p className="text-xs text-center" style={{ color: '#0063FF' }}>✓ Cloned to your library</p>
          )}
          {isCustom && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="w-full text-xs font-medium text-red-400 py-2 border border-red-100 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete playbook'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Skills Panel ────────────────────────────────────────────────────────

export default function SkillsPanel({ isDemo, onSelectSkill }: { isDemo: boolean; onSelectSkill: (skill: Skill) => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Skill | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSkills = () => {
    if (isDemo) {
      setSkills(DEMO_SKILLS)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch('/api/skills')
      .then(r => r.json())
      .then(d => {
        setSkills(d.skills ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    loadSkills()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo])

  // Group by category, respect display order
  const grouped = skills.reduce((acc, s) => {
    const cat = s.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {} as Record<string, Skill[]>)

  // Sort categories by preferred order, then alphabetically for others
  const orderedCats = [
    ...CATEGORY_ORDER.filter(c => grouped[c]),
    ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ]

  if (loading) {
    return (
      <div className="p-8 text-xs text-gray-400 flex items-center gap-2">
        <div
          className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
          style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }}
        />
        Loading skills…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="px-6 pt-6 pb-3 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Playbooks</p>
          {!isDemo && (
            <button
              onClick={() => { setCreating(true); setSelected(null) }}
              className="text-xs font-semibold px-3 py-1.5 text-white transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0063FF' }}
            >
              + New playbook
            </button>
          )}
        </div>

        {orderedCats.map(cat => (
          <div key={cat} className="mb-2">
            <div className="px-6 pt-5 pb-2 border-b border-gray-100">
              <h3
                className="text-base font-bold tracking-tight"
                style={{ color: CATEGORY_COLORS[cat] ?? '#080808' }}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </h3>
            </div>
            {grouped[cat].map(skill => (
              <button
                key={skill.id}
                onClick={() => { onSelectSkill(skill); setCreating(false) }}
                className="w-full text-left px-6 py-3 border-b border-gray-100 transition-colors hover:bg-gray-50 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{skill.name}</p>
                      {skill.is_system && !skill.gym_id && (
                        <span className="text-[10px] text-gray-300 flex-shrink-0">system</span>
                      )}
                      {skill.gym_id && (
                        <span className="text-[10px] flex-shrink-0 font-medium" style={{ color: '#0063FF' }}>custom</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{skill.description}</p>
                  </div>
                  <span className="text-xs text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-0.5 transition-colors">→</span>
                </div>
              </button>
            ))}
          </div>
        ))}

        {/* New Skill form */}
        {creating && (
          <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-900 mb-3">New playbook</p>
            {error && (
              <p className="text-xs text-red-500 mb-2">{error}</p>
            )}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Playbook name"
                value={newSkillName}
                onChange={e => setNewSkillName(e.target.value)}
                className="w-full text-xs border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400"
              />
              <textarea
                placeholder="What should this playbook do? Describe it in plain English."
                value={newSkillDesc}
                onChange={e => setNewSkillDesc(e.target.value)}
                rows={3}
                className="w-full text-xs border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
              />
              <div className="flex gap-2">
                <button
                  disabled={saving || !newSkillName.trim()}
                  className="text-xs font-semibold text-white px-3 py-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ backgroundColor: '#0063FF' }}
                  onClick={async () => {
                    if (!newSkillName.trim()) return
                    setSaving(true)
                    setError(null)
                    try {
                      const res = await fetch('/api/skills', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: newSkillName.trim(),
                          description: newSkillDesc.trim(),
                        }),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error ?? 'Failed to create')
                      setCreating(false)
                      setNewSkillName('')
                      setNewSkillDesc('')
                      loadSkills()
                    } catch (err: any) {
                      setError(err.message)
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  {saving ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={() => { setCreating(false); setError(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
