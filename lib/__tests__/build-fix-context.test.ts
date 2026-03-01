/**
 * build-fix-context.test.ts
 *
 * Tests for the pre-analysis script that parses FIX_BRIEF YAML blocks
 * from investigation comments and assembles compact context bundles
 * for the autofix pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ── Import the functions we're testing ──────────────────────────────────────

// We import the parsing/building functions directly (they don't have side effects)
import { parseFIXBRIEF, buildFixContext } from '../../scripts/build-fix-context'

// ── parseFIXBRIEF tests ─────────────────────────────────────────────────────

describe('parseFIXBRIEF', () => {
  it('parses a complete FIX_BRIEF block', () => {
    const text = `Some investigation text

<!-- FIX_BRIEF
target_files:
  - lib/agents/session-runtime.ts
  - components/AgentChat.tsx
test_file: lib/__tests__/session-runtime.test.ts
area: Agent Runtime
fix_approach: >
  The reconstructMessages function is not handling tool_use blocks.
  Add a case for tool_use content type in the message mapper.
red_test_sketch: >
  it('reconstructs tool_use messages', async () => { expect(true).toBe(true) })
confidence: high
risk_level: safe
risk_reason: null
END_FIX_BRIEF -->

### Likely Files
- lib/agents/session-runtime.ts`

    const result = parseFIXBRIEF(text)
    expect(result.target_files).toEqual([
      'lib/agents/session-runtime.ts',
      'components/AgentChat.tsx',
    ])
    expect(result.test_file).toBe('lib/__tests__/session-runtime.test.ts')
    expect(result.area).toBe('Agent Runtime')
    expect(result.fix_approach).toContain('reconstructMessages')
    expect(result.confidence).toBe('high')
    expect(result.risk_level).toBe('safe')
    expect(result.risk_reason).toBeNull()
  })

  it('returns defaults when no FIX_BRIEF block found', () => {
    const result = parseFIXBRIEF('Just a regular comment with no YAML')
    expect(result.target_files).toEqual([])
    expect(result.test_file).toBeNull()
    expect(result.area).toBeNull()
    expect(result.fix_approach).toBeNull()
    expect(result.confidence).toBeNull()
    expect(result.risk_level).toBeNull()
  })

  it('parses risk_reason with quoted strings', () => {
    const text = `<!-- FIX_BRIEF
target_files:
  - lib/auth.ts
risk_level: risky
risk_reason: "touches auth"
END_FIX_BRIEF -->`

    const result = parseFIXBRIEF(text)
    expect(result.risk_level).toBe('risky')
    expect(result.risk_reason).toBe('touches auth')
  })

  it('handles single target file', () => {
    const text = `<!-- FIX_BRIEF
target_files:
  - lib/single-file.ts
test_file: lib/__tests__/single-file.test.ts
confidence: medium
risk_level: safe
END_FIX_BRIEF -->`

    const result = parseFIXBRIEF(text)
    expect(result.target_files).toEqual(['lib/single-file.ts'])
    expect(result.confidence).toBe('medium')
  })

  it('handles null risk_reason', () => {
    const text = `<!-- FIX_BRIEF
target_files:
  - lib/foo.ts
risk_level: safe
risk_reason: null
END_FIX_BRIEF -->`

    const result = parseFIXBRIEF(text)
    expect(result.risk_reason).toBeNull()
  })
})

// ── buildFixContext tests ───────────────────────────────────────────────────

describe('buildFixContext', () => {
  it('includes fix approach and risk level in output', () => {
    const investigation = `<!-- FIX_BRIEF
target_files:
  - lib/nonexistent-file.ts
fix_approach: >
  Fix the broken thing by changing X to Y.
confidence: high
risk_level: safe
END_FIX_BRIEF -->

### Likely Files
- lib/nonexistent-file.ts`

    const context = buildFixContext(investigation)
    expect(context).toContain('# Fix Context Bundle')
    expect(context).toContain('Fix the broken thing')
    expect(context).toContain('Risk Level:** safe')
    expect(context).toContain('Confidence:** high')
  })

  it('includes file-not-found messages for missing files', () => {
    const investigation = `<!-- FIX_BRIEF
target_files:
  - lib/does-not-exist-at-all.ts
risk_level: safe
END_FIX_BRIEF -->`

    const context = buildFixContext(investigation)
    expect(context).toContain('lib/does-not-exist-at-all.ts')
    expect(context).toContain('File not found on disk')
  })

  it('reads actual files from disk when they exist', () => {
    // Use a file we know exists in the repo
    const investigation = `<!-- FIX_BRIEF
target_files:
  - lib/models.ts
risk_level: safe
END_FIX_BRIEF -->`

    const context = buildFixContext(investigation)
    // models.ts should exist and contain HAIKU/SONNET constants
    expect(context).toContain('lib/models.ts')
    // Should contain actual file content (not "not found")
    expect(context).not.toContain('File not found on disk')
  })

  it('includes full investigation text at the end', () => {
    const investigation = `<!-- FIX_BRIEF
target_files:
  - lib/foo.ts
risk_level: safe
END_FIX_BRIEF -->

### Root Cause Hypothesis
The bug is caused by a missing null check.`

    const context = buildFixContext(investigation)
    expect(context).toContain('## Full Investigation')
    expect(context).toContain('Root Cause Hypothesis')
    expect(context).toContain('missing null check')
  })

  it('handles investigation without FIX_BRIEF gracefully', () => {
    const investigation = `## AI Investigation
Just a regular investigation without structured output.
### Likely Files
- lib/some-file.ts`

    const context = buildFixContext(investigation)
    expect(context).toContain('# Fix Context Bundle')
    expect(context).toContain('## Full Investigation')
    expect(context).toContain('regular investigation')
  })

  it('includes red test sketch when present', () => {
    const investigation = `<!-- FIX_BRIEF
target_files:
  - lib/foo.ts
test_file: lib/__tests__/foo.test.ts
red_test_sketch: >
  it('should return 404 when not found', async () => {
    const res = await handler(makeReq())
    expect(res.status).toBe(404)
  })
risk_level: safe
END_FIX_BRIEF -->`

    const context = buildFixContext(investigation)
    expect(context).toContain('## Red Test Sketch')
    expect(context).toContain('should return 404')
  })
})
