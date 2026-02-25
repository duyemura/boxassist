/**
 * models.test.ts
 *
 * Verifies centralized model constants are correct and used consistently.
 */
import { describe, it, expect } from 'vitest'
import { SONNET, HAIKU } from '../models'

describe('lib/models.ts', () => {
  it('exports SONNET as claude-sonnet-4-6', () => {
    expect(SONNET).toBe('claude-sonnet-4-6')
  })

  it('exports HAIKU as claude-haiku-4-5-20251001', () => {
    expect(HAIKU).toBe('claude-haiku-4-5-20251001')
  })

  it('SONNET and HAIKU are different models', () => {
    expect(SONNET).not.toBe(HAIKU)
  })
})
