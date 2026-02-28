/**
 * Bug triage engine — transforms raw error data into structured,
 * auto-fixable bug tickets.
 *
 * Parses stack traces, classifies areas, triages auto-fixable vs needs-human,
 * and builds structured tickets following the linear-bug-ticket skill template.
 *
 * No AI calls — pure deterministic analysis. The auto-fix agent (Claude) that
 * picks up the ticket does the deep investigation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedFrame {
  file: string
  line: number
  column?: number
  fn: string
}

export interface TriageResult {
  autoFixable: boolean
  reason: string
}

export interface BugTicketInput {
  errorMessage: string
  stack?: string
  pageUrl?: string
  screenshotUrl?: string | null
  navigationHistory?: string[]
  viewport?: { width: number; height: number }
  userAgent?: string
  feedbackId?: string
  feedbackType?: string
}

export interface StructuredTicket {
  title: string
  description: string
  priority: number
  labels: string[]
  area: string
}

// ── Stack trace parsing ─────────────────────────────────────────────────────

// Matches lines like:
//   at functionName (file:line:col)
//   at file:line:col
//   at functionName (webpack-internal:///./file:line:col)
const FRAME_RE =
  /at\s+(?:(?:new\s+)?(\S+)\s+\()?(?:webpack-internal:\/\/\/\.\/)?(?:file:\/\/)?(.+?):(\d+):(\d+)\)?/

// Paths to skip: node internals, node_modules
const SKIP_PATTERNS = [
  /node_modules\//,
  /^node:/,
  /^internal\//,
  /react-dom/,
  /react\.development/,
  /scheduler/,
  /webpack/,
]

// Known project root prefixes to strip
const ROOT_PREFIXES = [
  /^.*?\/gymagents\//,
  /^\/app\//,
  /^\.\//,
]

export function parseStackTrace(stack: string | undefined | null): ParsedFrame[] {
  if (!stack) return []

  const lines = stack.split('\n')
  const frames: ParsedFrame[] = []

  for (const line of lines) {
    const match = line.match(FRAME_RE)
    if (!match) continue

    const [, fn, rawFile, lineStr, colStr] = match

    // Skip node internals and node_modules
    if (SKIP_PATTERNS.some(p => p.test(rawFile))) continue

    // Normalize file path — strip project root
    let file = rawFile
    for (const prefix of ROOT_PREFIXES) {
      file = file.replace(prefix, '')
    }

    frames.push({
      file,
      line: parseInt(lineStr, 10),
      column: colStr ? parseInt(colStr, 10) : undefined,
      fn: fn || '',
    })
  }

  return frames
}

// ── Area classification ─────────────────────────────────────────────────────

const AREA_RULES: [RegExp, string][] = [
  [/app\/setup/, 'Setup'],
  [/app\/api\/cron/, 'Cron'],
  [/app\/api\/webhooks/, 'Email'],
  [/app\/api\/setup/, 'Setup'],
  [/app\/api\//, 'API'],
  [/app\/dashboard/, 'Dashboard'],
  [/lib\/agents\//, 'Agent Runtime'],
  [/lib\/reply-agent/, 'Email'],
  [/lib\/db\//, 'Database'],
  [/lib\/migrations\//, 'Database'],
  [/lib\/pushpress/, 'API'],
  [/lib\/task-skills\//, 'Agent Runtime'],
  [/components\//, 'Dashboard'],
]

export function classifyArea(filePath: string): string {
  if (!filePath) return 'General'
  for (const [pattern, area] of AREA_RULES) {
    if (pattern.test(filePath)) return area
  }
  return 'General'
}

// ── Auto-fixable triage ─────────────────────────────────────────────────────

// Error types that are typically mechanical fixes
const MECHANICAL_ERRORS = [
  /TypeError/i,
  /ReferenceError/i,
  /Cannot read propert/i,
  /is not a function/i,
  /is not defined/i,
  /is undefined/i,
  /is null/i,
  /PGRST/,
  /unexpected token/i,
  /status\s+\d{3}/i,
]

// Files that should never be auto-fixed
const PROTECTED_FILES = [
  /lib\/auth\.ts/,
  /lib\/supabase\.ts/,
  /lib\/migrations\//,
  /\.env/,
  /middleware\.ts/,
]

interface TriageInput {
  errorMessage: string
  frames: ParsedFrame[]
  area: string
}

export function triageAutoFixable(input: TriageInput): TriageResult {
  const { errorMessage, frames, area } = input

  // No stack trace = can't locate the bug
  if (frames.length === 0) {
    return { autoFixable: false, reason: 'No stack trace — cannot locate the source.' }
  }

  // Protected files
  const primaryFile = frames[0].file
  for (const pattern of PROTECTED_FILES) {
    if (pattern.test(primaryFile)) {
      const label = primaryFile.includes('auth') ? 'auth' :
        primaryFile.includes('migration') ? 'migration' : 'protected'
      return { autoFixable: false, reason: `Touches ${label} file (\`${primaryFile}\`) — needs human review.` }
    }
  }

  // Mechanical error types with a clear stack → auto-fixable
  const isMechanical = MECHANICAL_ERRORS.some(p => p.test(errorMessage))
  if (isMechanical) {
    return { autoFixable: true, reason: `Mechanical error (${errorMessage.split(':')[0]}) with clear stack trace at \`${primaryFile}:${frames[0].line}\`.` }
  }

  // Vague errors without a clear error type
  return { autoFixable: false, reason: `Unclear error type — no TypeError/ReferenceError/etc. Needs human triage.` }
}

// ── Area to label mapping ───────────────────────────────────────────────────

const AREA_LABELS: Record<string, string> = {
  'Dashboard': 'dashboard',
  'API': 'api',
  'Agent Runtime': 'agent',
  'Setup': 'setup',
  'Cron': 'cron',
  'Email': 'email',
  'Database': 'api',
  'General': 'api',
}

// ── Red test sketch generator ───────────────────────────────────────────────

function buildRedTestSketch(frames: ParsedFrame[], errorMessage: string, area: string): string {
  if (frames.length === 0) {
    return '> Unable to generate test sketch — no stack trace available. Manual investigation required.'
  }

  const primary = frames[0]
  const testFile = guessTestFile(primary.file)
  const errorType = errorMessage.split(':')[0].trim()
  const errorDetail = errorMessage.split(':').slice(1).join(':').trim()

  const lines: string[] = []
  lines.push(`- **Test file:** \`${testFile}\``)
  lines.push(`- **Target:** \`${primary.file}:${primary.line}\` → \`${primary.fn || '(anonymous)'}\``)
  lines.push('')
  lines.push('```typescript')

  if (area === 'API' || primary.file.startsWith('app/api/')) {
    // API route test sketch
    const routePath = primary.file
      .replace('app/api/', '/api/')
      .replace('/route.ts', '')
    lines.push(`it('handles ${errorType} at ${primary.fn || routePath}', async () => {`)
    lines.push(`  // Reproduce: call the route with input that triggers the error`)
    lines.push(`  const req = new NextRequest('http://localhost:3000${routePath}', {`)
    lines.push(`    method: 'POST',`)
    lines.push(`    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },`)
    lines.push(`    body: JSON.stringify({ /* TODO: input that triggers ${errorDetail} */ }),`)
    lines.push(`  })`)
    lines.push(`  const res = await POST(req, { params: { /* TODO */ } })`)
    lines.push(`  // Should not crash — return structured error`)
    lines.push(`  expect(res.status).toBeLessThan(500)`)
    lines.push(`})`)
  } else if (area === 'Dashboard' || primary.file.startsWith('components/')) {
    // Component test sketch
    lines.push(`it('does not throw ${errorType} in ${primary.fn || 'component'}', async () => {`)
    lines.push(`  // Reproduce: render with data that triggers the error`)
    lines.push(`  // The error occurs at ${primary.file}:${primary.line}`)
    lines.push(`  // ${errorMessage}`)
    lines.push(`  // TODO: mock the data source to return the triggering state`)
    lines.push(`  // expect(result).not.toThrow()`)
    lines.push(`})`)
  } else {
    // Generic lib function test sketch
    lines.push(`it('handles ${errorType} in ${primary.fn || 'target function'}', async () => {`)
    lines.push(`  // Reproduce the error at ${primary.file}:${primary.line}`)
    lines.push(`  // ${errorMessage}`)
    lines.push(`  // TODO: call ${primary.fn || 'the function'} with input that triggers the error`)
    lines.push(`  // expect(result).toBeDefined()`)
    lines.push(`})`)
  }

  lines.push('```')
  return lines.join('\n')
}

function guessTestFile(file: string): string {
  // app/api/integrations/[id]/connect/route.ts → lib/__tests__/integrations.test.ts
  // components/AgentList.tsx → lib/__tests__/agent-list.test.ts
  // lib/db/memories.ts → lib/__tests__/memories.test.ts
  // lib/skill-loader.ts → lib/__tests__/skill-loader.test.ts

  if (file.startsWith('app/api/')) {
    const parts = file.replace('app/api/', '').split('/')
    const name = parts[0] // first segment after app/api/
    return `lib/__tests__/${name}.test.ts`
  }

  if (file.startsWith('components/')) {
    const name = file.replace('components/', '').replace(/\.tsx?$/, '')
    const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
    return `lib/__tests__/${kebab}.test.ts`
  }

  if (file.startsWith('lib/db/')) {
    const name = file.replace('lib/db/', '').replace(/\.ts$/, '')
    return `lib/__tests__/${name}.test.ts`
  }

  if (file.startsWith('lib/')) {
    const name = file.replace('lib/', '').replace(/\.ts$/, '')
    return `lib/__tests__/${name}.test.ts`
  }

  return `lib/__tests__/${file.replace(/[/\\]/g, '-').replace(/\.tsx?$/, '')}.test.ts`
}

// ── Structured ticket builder ───────────────────────────────────────────────

export function buildStructuredTicket(input: BugTicketInput): StructuredTicket {
  const frames = parseStackTrace(input.stack)
  const primaryFile = frames[0]?.file ?? ''
  const area = classifyArea(primaryFile || extractAreaFromUrl(input.pageUrl))
  const triage = triageAutoFixable({ errorMessage: input.errorMessage, frames, area })

  // ── Title ──
  const errorBrief = input.errorMessage.replace(/\n/g, ' ').slice(0, 70)
  const title = `[${area}] ${errorBrief}${input.errorMessage.length > 70 ? '…' : ''}`

  // ── Description ──
  const sections: string[] = []

  // What happens
  sections.push('## What happens')
  sections.push(input.errorMessage)
  sections.push('')

  // Technical context
  if (frames.length > 0) {
    const primary = frames[0]
    sections.push('## Technical context')
    sections.push(`- **File:** \`${primary.file}:${primary.line}\``)
    sections.push(`- **Function:** \`${primary.fn || '(anonymous)'}\``)
    if (input.pageUrl) {
      sections.push(`- **Page:** ${input.pageUrl}`)
    }
    sections.push('')

    // Call stack (project frames only)
    sections.push('**Stack trace (project frames):**')
    sections.push('```')
    for (const frame of frames.slice(0, 8)) {
      sections.push(`  at ${frame.fn || '(anonymous)'} (${frame.file}:${frame.line}${frame.column ? ':' + frame.column : ''})`)
    }
    if (frames.length > 8) {
      sections.push(`  ... ${frames.length - 8} more frames`)
    }
    sections.push('```')
    sections.push('')
  } else {
    // No stack trace — include what we have
    if (input.pageUrl) {
      sections.push('## Technical context')
      sections.push(`- **Page:** ${input.pageUrl}`)
      sections.push(`- **Error:** ${input.errorMessage}`)
      sections.push(`- **No stack trace available**`)
      sections.push('')
    }
  }

  // Screenshot
  if (input.screenshotUrl) {
    sections.push('## Screenshot')
    sections.push(`![Screenshot](${input.screenshotUrl})`)
    sections.push('')
  }

  // Navigation
  if (input.navigationHistory?.length) {
    sections.push('## Navigation')
    sections.push(`User path before error:`)
    for (const path of input.navigationHistory) {
      sections.push(`- \`${path}\``)
    }
    sections.push('')
  }

  // Environment
  const envParts: string[] = []
  if (input.viewport) envParts.push(`**Viewport:** ${input.viewport.width}x${input.viewport.height}`)
  if (input.userAgent) envParts.push(`**Browser:** ${input.userAgent}`)
  if (input.feedbackId) envParts.push(`**Feedback ID:** \`${input.feedbackId}\``)
  if (envParts.length > 0) {
    sections.push('## Environment')
    sections.push(envParts.join(' · '))
    sections.push('')
  }

  // Red test sketch
  sections.push('## Red test sketch')
  sections.push(buildRedTestSketch(frames, input.errorMessage, area))
  sections.push('')

  // Triage
  sections.push('## Triage')
  sections.push(`**Classification:** ${triage.autoFixable ? '✅ auto-fixable' : '⚠️ needs-human'}`)
  sections.push(`**Reason:** ${triage.reason}`)
  sections.push('')

  // ── Labels ──
  const labels: string[] = [input.feedbackType === 'error' ? 'error' : 'bug']
  labels.push(triage.autoFixable ? 'auto-fixable' : 'needs-human')
  const areaLabel = AREA_LABELS[area]
  if (areaLabel) labels.push(areaLabel)

  // ── Priority ──
  // auto-fixable = High (2), needs-human = Normal (3)
  const priority = triage.autoFixable ? 2 : 3

  return { title, description: sections.join('\n'), priority, labels, area }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractAreaFromUrl(url?: string): string {
  if (!url) return ''
  try {
    const pathname = new URL(url).pathname
    if (pathname.startsWith('/dashboard')) return 'app/dashboard/page.tsx'
    if (pathname.startsWith('/setup')) return 'app/setup/page.tsx'
    if (pathname.startsWith('/api/')) return `app${pathname}/route.ts`
    return ''
  } catch {
    return ''
  }
}
