/**
 * error-fingerprint.test.ts
 *
 * Tests for generateErrorFingerprint() and normalizeErrorMessage()
 * in lib/bug-triage.ts.
 */

import { describe, it, expect } from 'vitest'
import { generateErrorFingerprint, normalizeErrorMessage } from '../bug-triage'

// ── normalizeErrorMessage ───────────────────────────────────────────────────

describe('normalizeErrorMessage', () => {
  it('strips UUIDs', () => {
    const msg = 'Cannot find user 550e8400-e29b-41d4-a716-446655440000 in db'
    expect(normalizeErrorMessage(msg)).toBe('Cannot find user <UUID> in db')
  })

  it('strips long hex strings (Mongo IDs, hashes)', () => {
    const msg = 'Document 507f1f77bcf86cd799439011 not found'
    expect(normalizeErrorMessage(msg)).toBe('Document <HEX> not found')
  })

  it('strips double-quoted strings', () => {
    const msg = 'Cannot read property "name" of undefined'
    expect(normalizeErrorMessage(msg)).toBe('Cannot read property <STR> of undefined')
  })

  it('strips single-quoted strings', () => {
    const msg = "Expected 'object' but got 'undefined'"
    expect(normalizeErrorMessage(msg)).toBe('Expected <STR> but got <STR>')
  })

  it('strips bare numbers', () => {
    const msg = 'Request failed with status 404 after 3 retries'
    expect(normalizeErrorMessage(msg)).toBe('Request failed with status <N> after <N> retries')
  })

  it('strips decimal numbers', () => {
    const msg = 'Timeout after 3.5 seconds'
    expect(normalizeErrorMessage(msg)).toBe('Timeout after <N> seconds')
  })

  it('collapses whitespace', () => {
    const msg = 'Error   in   component   rendering'
    expect(normalizeErrorMessage(msg)).toBe('Error in component rendering')
  })

  it('handles combined normalizations', () => {
    const msg = 'User 550e8400-e29b-41d4-a716-446655440000 failed at step 3 with "bad input"'
    const result = normalizeErrorMessage(msg)
    expect(result).toBe('User <UUID> failed at step <N> with <STR>')
  })
})

// ── generateErrorFingerprint ────────────────────────────────────────────────

describe('generateErrorFingerprint', () => {
  it('returns null for empty message', async () => {
    expect(await generateErrorFingerprint('')).toBeNull()
  })

  it('returns a 16-char hex string', async () => {
    const fp = await generateErrorFingerprint('TypeError: x is not a function')
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('same message + same stack → same fingerprint', async () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'map')"
    const stack = `TypeError: Cannot read properties of undefined (reading 'map')
    at AgentList (webpack-internal:///./components/AgentList.tsx:45:22)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:16305:18)`

    const fp1 = await generateErrorFingerprint(msg, stack)
    const fp2 = await generateErrorFingerprint(msg, stack)
    expect(fp1).toBe(fp2)
  })

  it('same message + different line numbers → same fingerprint', async () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'map')"
    const stack1 = `TypeError: blah
    at AgentList (webpack-internal:///./components/AgentList.tsx:45:22)`
    const stack2 = `TypeError: blah
    at AgentList (webpack-internal:///./components/AgentList.tsx:99:10)`

    const fp1 = await generateErrorFingerprint(msg, stack1)
    const fp2 = await generateErrorFingerprint(msg, stack2)
    expect(fp1).toBe(fp2)
  })

  it('same message + different file → different fingerprint', async () => {
    const msg = 'TypeError: x is not a function'
    const stack1 = `TypeError: x is not a function
    at render (webpack-internal:///./components/A.tsx:10:5)`
    const stack2 = `TypeError: x is not a function
    at render (webpack-internal:///./components/B.tsx:10:5)`

    const fp1 = await generateErrorFingerprint(msg, stack1)
    const fp2 = await generateErrorFingerprint(msg, stack2)
    expect(fp1).not.toBe(fp2)
  })

  it('different message + same stack → different fingerprint', async () => {
    const stack = `Error: blah
    at render (webpack-internal:///./components/A.tsx:10:5)`

    const fp1 = await generateErrorFingerprint('Error A', stack)
    const fp2 = await generateErrorFingerprint('Error B', stack)
    expect(fp1).not.toBe(fp2)
  })

  it('no stack → uses "no-stack" key and still produces a fingerprint', async () => {
    const fp = await generateErrorFingerprint('Something broke')
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('no stack: same message → same fingerprint', async () => {
    const fp1 = await generateErrorFingerprint('Something broke')
    const fp2 = await generateErrorFingerprint('Something broke')
    expect(fp1).toBe(fp2)
  })

  it('normalizes UUIDs in message so different IDs produce same fingerprint', async () => {
    const fp1 = await generateErrorFingerprint(
      'User 550e8400-e29b-41d4-a716-446655440000 not found',
    )
    const fp2 = await generateErrorFingerprint(
      'User a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found',
    )
    expect(fp1).toBe(fp2)
  })

  it('normalizes numbers in message so different counts produce same fingerprint', async () => {
    const fp1 = await generateErrorFingerprint('Request failed with status 404')
    const fp2 = await generateErrorFingerprint('Request failed with status 500')
    expect(fp1).toBe(fp2)
  })
})
