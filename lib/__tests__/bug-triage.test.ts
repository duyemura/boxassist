/**
 * Tests for bug-triage.ts — stack trace parsing, area classification,
 * auto-fixable triage, and structured ticket generation.
 */

import { describe, it, expect } from 'vitest'
import {
  parseStackTrace,
  classifyArea,
  triageAutoFixable,
  buildStructuredTicket,
  type ParsedFrame,
  type BugTicketInput,
} from '../bug-triage'

// ── Stack trace parsing ─────────────────────────────────────────────────────

describe('parseStackTrace', () => {
  it('parses a typical Next.js client-side stack', () => {
    const stack = `Error: No Composio-managed auth config found for toolkit: notion
    at handleConnect (webpack-internal:///./components/IntegrationsPanel.tsx:132:15)
    at onClick (webpack-internal:///./components/IntegrationsPanel.tsx:189:7)
    at HTMLUnknownElement.callCallback (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:4164:14)`

    const frames = parseStackTrace(stack)

    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames[0]).toMatchObject({
      file: 'components/IntegrationsPanel.tsx',
      line: 132,
      fn: 'handleConnect',
    })
    expect(frames[1]).toMatchObject({
      file: 'components/IntegrationsPanel.tsx',
      line: 189,
      fn: 'onClick',
    })
  })

  it('parses a server-side Node.js stack', () => {
    const stack = `Error: getIntegrations failed
    at getIntegrations (/Users/dan/Development/pushpress/gymagents/lib/db/integrations.ts:42:11)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at GET (/Users/dan/Development/pushpress/gymagents/app/api/integrations/route.ts:18:22)`

    const frames = parseStackTrace(stack)

    expect(frames.length).toBeGreaterThanOrEqual(2)
    expect(frames[0]).toMatchObject({
      file: 'lib/db/integrations.ts',
      line: 42,
      fn: 'getIntegrations',
    })
    // Should skip node internals
    expect(frames[1]).toMatchObject({
      file: 'app/api/integrations/route.ts',
      line: 18,
      fn: 'GET',
    })
  })

  it('filters out node_modules and node internals', () => {
    const stack = `Error: boom
    at Object.<anonymous> (/app/lib/agents/agent-runtime.ts:55:9)
    at Module._compile (node:internal/modules/cjs/loader:1241:14)
    at doSomething (/app/node_modules/some-pkg/index.js:10:5)`

    const frames = parseStackTrace(stack)

    expect(frames).toHaveLength(1)
    expect(frames[0].file).toBe('lib/agents/agent-runtime.ts')
  })

  it('returns empty array for empty or missing stack', () => {
    expect(parseStackTrace('')).toEqual([])
    expect(parseStackTrace(undefined as any)).toEqual([])
  })

  it('handles webpack chunk paths', () => {
    const stack = `TypeError: Cannot read properties of undefined (reading 'map')
    at AgentList (webpack-internal:///./components/AgentList.tsx:45:22)
    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:16305:18)`

    const frames = parseStackTrace(stack)

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      file: 'components/AgentList.tsx',
      line: 45,
      fn: 'AgentList',
    })
  })
})

// ── Area classification ─────────────────────────────────────────────────────

describe('classifyArea', () => {
  it('classifies dashboard components', () => {
    expect(classifyArea('app/dashboard/page.tsx')).toBe('Dashboard')
    expect(classifyArea('components/AgentList.tsx')).toBe('Dashboard')
  })

  it('classifies API routes', () => {
    expect(classifyArea('app/api/integrations/route.ts')).toBe('API')
    expect(classifyArea('app/api/feedback/route.ts')).toBe('API')
  })

  it('classifies agent runtime', () => {
    expect(classifyArea('lib/agents/agent-runtime.ts')).toBe('Agent Runtime')
    expect(classifyArea('lib/agents/GMAgent.ts')).toBe('Agent Runtime')
  })

  it('classifies setup wizard', () => {
    expect(classifyArea('app/setup/page.tsx')).toBe('Setup')
    expect(classifyArea('app/api/setup/recommend/route.ts')).toBe('Setup')
  })

  it('classifies cron jobs', () => {
    expect(classifyArea('app/api/cron/run-analysis/route.ts')).toBe('Cron')
  })

  it('classifies email/messaging', () => {
    expect(classifyArea('lib/reply-agent.ts')).toBe('Email')
    expect(classifyArea('app/api/webhooks/resend/route.ts')).toBe('Email')
  })

  it('classifies database helpers', () => {
    expect(classifyArea('lib/db/integrations.ts')).toBe('Database')
    expect(classifyArea('lib/db/memories.ts')).toBe('Database')
  })

  it('returns General for unknown paths', () => {
    expect(classifyArea('lib/utils.ts')).toBe('General')
    expect(classifyArea('')).toBe('General')
  })
})

// ── Auto-fixable triage ─────────────────────────────────────────────────────

describe('triageAutoFixable', () => {
  it('marks TypeError with file/line as auto-fixable', () => {
    const result = triageAutoFixable({
      errorMessage: "TypeError: Cannot read properties of undefined (reading 'id')",
      frames: [{ file: 'components/AgentList.tsx', line: 45, fn: 'AgentList' }],
      area: 'Dashboard',
    })
    expect(result.autoFixable).toBe(true)
  })

  it('marks reference errors as auto-fixable', () => {
    const result = triageAutoFixable({
      errorMessage: 'ReferenceError: foo is not defined',
      frames: [{ file: 'lib/skill-loader.ts', line: 10, fn: 'loadSkills' }],
      area: 'General',
    })
    expect(result.autoFixable).toBe(true)
  })

  it('marks errors with no stack frames as needs-human', () => {
    const result = triageAutoFixable({
      errorMessage: 'Something went wrong',
      frames: [],
      area: 'General',
    })
    expect(result.autoFixable).toBe(false)
    expect(result.reason).toContain('No stack trace')
  })

  it('marks auth-related files as needs-human', () => {
    const result = triageAutoFixable({
      errorMessage: 'TypeError: token is undefined',
      frames: [{ file: 'lib/auth.ts', line: 22, fn: 'getSession' }],
      area: 'General',
    })
    expect(result.autoFixable).toBe(false)
    expect(result.reason).toContain('auth')
  })

  it('marks database migration files as needs-human', () => {
    const result = triageAutoFixable({
      errorMessage: 'Error in migration',
      frames: [{ file: 'lib/migrations/015_data_lens.sql', line: 1, fn: '' }],
      area: 'Database',
    })
    expect(result.autoFixable).toBe(false)
    expect(result.reason).toContain('migration')
  })

  it('marks vague errors without clear type as needs-human', () => {
    const result = triageAutoFixable({
      errorMessage: 'Something failed',
      frames: [{ file: 'lib/utils.ts', line: 10, fn: 'doStuff' }],
      area: 'General',
    })
    expect(result.autoFixable).toBe(false)
    expect(result.reason).toContain('Unclear error')
  })
})

// ── Structured ticket builder ───────────────────────────────────────────────

describe('buildStructuredTicket', () => {
  const baseInput: BugTicketInput = {
    errorMessage: "TypeError: Cannot read properties of undefined (reading 'map')",
    stack: `TypeError: Cannot read properties of undefined (reading 'map')
    at AgentList (webpack-internal:///./components/AgentList.tsx:45:22)
    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:16305:18)`,
    pageUrl: 'http://localhost:3000/dashboard',
    screenshotUrl: 'https://storage.example.com/shot.png',
    navigationHistory: ['/setup', '/dashboard'],
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 Chrome/120',
    feedbackId: 'fb-123',
  }

  it('generates a structured title with area tag', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.title).toMatch(/^\[Dashboard\]/)
    expect(ticket.title).toContain('undefined')
    expect(ticket.title.length).toBeLessThanOrEqual(100)
  })

  it('includes What Happens section', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## What happens')
    expect(ticket.description).toContain("Cannot read properties of undefined")
  })

  it('includes Technical Context with file and line', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## Technical context')
    expect(ticket.description).toContain('`components/AgentList.tsx:45`')
    expect(ticket.description).toContain('`AgentList`')
  })

  it('includes stack trace as code block', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('```')
    expect(ticket.description).toContain('AgentList')
  })

  it('includes screenshot when provided', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## Screenshot')
    expect(ticket.description).toContain('![Screenshot]')
  })

  it('includes red test sketch', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## Red test sketch')
    expect(ticket.description).toContain('components/AgentList')
  })

  it('includes triage classification', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## Triage')
    expect(ticket.description).toContain('auto-fixable')
  })

  it('sets correct labels for auto-fixable bugs', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.labels).toContain('bug')
    expect(ticket.labels).toContain('auto-fixable')
    expect(ticket.labels).toContain('dashboard')
  })

  it('sets needs-human label when not auto-fixable', () => {
    const input: BugTicketInput = {
      errorMessage: 'Something went wrong',
      pageUrl: 'http://localhost:3000/dashboard',
    }
    const ticket = buildStructuredTicket(input)
    expect(ticket.labels).toContain('needs-human')
  })

  it('generates navigation context when available', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('## Navigation')
    expect(ticket.description).toContain('/setup')
    expect(ticket.description).toContain('/dashboard')
  })

  it('includes feedback ID for traceability', () => {
    const ticket = buildStructuredTicket(baseInput)
    expect(ticket.description).toContain('`fb-123`')
  })

  it('handles minimal input gracefully', () => {
    const ticket = buildStructuredTicket({
      errorMessage: 'Network error',
    })
    expect(ticket.title).toMatch(/^\[General\]/)
    expect(ticket.description).toContain('## What happens')
    expect(ticket.labels).toContain('needs-human')
  })

  it('maps priority based on error type', () => {
    const typeError = buildStructuredTicket({
      ...baseInput,
      errorMessage: 'TypeError: x is not a function',
    })
    // TypeError with stack = auto-fixable = High priority
    expect(typeError.priority).toBe(2)

    const vague = buildStructuredTicket({
      errorMessage: 'Something broke',
    })
    // Vague error = needs-human = Normal priority
    expect(vague.priority).toBe(3)
  })
})
