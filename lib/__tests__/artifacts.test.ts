import { describe, it, expect } from 'vitest'
import { renderArtifact } from '../artifacts/render'
import type { ResearchSummaryData } from '../artifacts/types'

const SAMPLE_DATA: ResearchSummaryData = {
  gymName: 'PushPress East',
  generatedAt: '2026-02-25T21:00:00Z',
  period: 'February 2026',
  generatedBy: 'GM Agent',
  stats: {
    membersAtRisk: 5,
    membersRetained: 3,
    revenueRetained: 450,
    messagesSent: 12,
    conversationsActive: 2,
    escalations: 1,
  },
  members: [
    {
      name: 'Alex Thompson',
      email: 'alex@example.com',
      status: 'retained',
      riskLevel: 'high',
      detail: 'Hadn\'t visited in 14 days. Agent reached out, Alex committed to Tuesday class.',
      lastCheckin: '3 days ago',
      membershipValue: 150,
    },
    {
      name: 'Sarah Mitchell',
      status: 'at_risk',
      riskLevel: 'medium',
      detail: 'Visit frequency dropped from 4x/week to 1x/week over the past month.',
      lastCheckin: '8 days ago',
    },
    {
      name: 'Jordan Lee',
      status: 'escalated',
      riskLevel: 'high',
      detail: 'Mentioned knee injury in reply. Needs personal follow-up from owner.',
    },
    {
      name: 'Chris Davis',
      status: 'churned',
      detail: 'Cancelled membership. Win-back sequence sent, no response after 3 touches.',
    },
  ],
  insights: [
    '5 members flagged across 3 categories',
    '1 critical priority — review these first',
    '3 members retained this month, saving $450',
  ],
  trend: {
    retainedPrev: 2,
    revenuePrev: 300,
    direction: 'up',
  },
}

describe('Artifact rendering', () => {
  it('renders research_summary as valid HTML document', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('</html>')
  })

  it('includes gym name and period', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('PushPress East')
    expect(html).toContain('February 2026')
    expect(html).toContain('GM Agent')
  })

  it('renders hero stat cards', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('At Risk')
    expect(html).toContain('Retained')
    expect(html).toContain('Revenue Saved')
    expect(html).toContain('$450')
    expect(html).toContain('Messages')
    expect(html).toContain('Escalations')
  })

  it('renders member cards with status badges', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('Alex Thompson')
    expect(html).toContain('$150/mo')
    expect(html).toContain('Sarah Mitchell')
    expect(html).toContain('Jordan Lee')
    expect(html).toContain('Chris Davis')
  })

  it('renders insights section', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('Insights')
    expect(html).toContain('5 members flagged across 3 categories')
    expect(html).toContain('1 critical priority')
  })

  it('renders trend comparison', () => {
    const html = renderArtifact('research_summary', SAMPLE_DATA as unknown as Record<string, unknown>)
    expect(html).toContain('vs last month')
    expect(html).toContain('2 retained')
    expect(html).toContain('$300')
  })

  it('escapes HTML in member names and details', () => {
    const data = {
      ...SAMPLE_DATA,
      members: [{
        name: '<script>alert("xss")</script>',
        status: 'at_risk' as const,
        detail: 'Test <b>bold</b> & "quotes"',
      }],
    }
    const html = renderArtifact('research_summary', data as unknown as Record<string, unknown>)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('handles empty members and insights gracefully', () => {
    const data: ResearchSummaryData = {
      ...SAMPLE_DATA,
      members: [],
      insights: [],
    }
    const html = renderArtifact('research_summary', data as unknown as Record<string, unknown>)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).not.toContain('Member Activity')
    expect(html).not.toContain('Insights &amp; Recommendations')
  })

  it('returns fallback for unknown artifact types', () => {
    const html = renderArtifact('unknown_type' as any, {})
    expect(html).toContain('Unknown artifact type')
  })
})
