import { describe, it, expect } from 'vitest'
import { parseToolResult } from '../tool-result-parse'

describe('parseToolResult', () => {
  it('detects error from an object with error key', () => {
    const r = parseToolResult({ error: 'something went wrong' })
    expect(r.isError).toBe(true)
    expect(r.summary).toBe('something went wrong')
  })

  it('handles a JSON string containing an error', () => {
    const r = parseToolResult('{"error":"Failed to fetch members: PushPress v3 API 401 /customers: Unauthorized"}')
    expect(r.isError).toBe(true)
    expect(r.summary).toContain('Failed to fetch members')
  })

  it('handles a plain string result', () => {
    const r = parseToolResult('some plain string')
    expect(r.isError).toBe(false)
    expect(r.summary).toBe('Done')
  })

  it('handles null/undefined', () => {
    expect(parseToolResult(null).isError).toBe(false)
    expect(parseToolResult(null).summary).toBe('Done')
    expect(parseToolResult(undefined).isError).toBe(false)
    expect(parseToolResult(undefined).summary).toBe('Done')
  })

  it('extracts status from result object', () => {
    const r = parseToolResult({ status: 'completed' })
    expect(r.isError).toBe(false)
    expect(r.summary).toBe('completed')
  })

  it('extracts count from result object', () => {
    expect(parseToolResult({ count: 0 }).summary).toBe('0 results')
    expect(parseToolResult({ count: 1 }).summary).toBe('1 result')
    expect(parseToolResult({ count: 5 }).summary).toBe('5 results')
  })

  it('returns Done for object with no recognized keys', () => {
    const r = parseToolResult({ foo: 'bar' })
    expect(r.isError).toBe(false)
    expect(r.summary).toBe('Done')
  })

  it('handles a number', () => {
    const r = parseToolResult(42)
    expect(r.isError).toBe(false)
    expect(r.summary).toBe('Done')
  })

  it('returns the parsed object for expansion', () => {
    const obj = { error: 'bad' }
    const r = parseToolResult(obj)
    expect(r.parsed).toBe(obj)
  })

  it('returns the parsed object from a JSON string', () => {
    const r = parseToolResult('{"status":"ok"}')
    expect(r.parsed).toEqual({ status: 'ok' })
  })
})
