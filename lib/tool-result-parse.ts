/**
 * Parse a tool result (which may be an object, JSON string, or primitive)
 * into a normalized shape for display. Safely handles all input types
 * without throwing — the 'in' operator requires an object, so we guard
 * against strings and other primitives.
 */
export function parseToolResult(result: unknown): {
  isError: boolean
  summary: string
  parsed: unknown
} {
  let r: Record<string, unknown> | null = null

  if (result != null && typeof result === 'object') {
    r = result as Record<string, unknown>
  } else if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result)
      if (parsed && typeof parsed === 'object') {
        r = parsed as Record<string, unknown>
      }
    } catch {
      // not JSON — treat as opaque value
    }
  }

  if (!r) {
    return { isError: false, summary: 'Done', parsed: result }
  }

  const isError = 'error' in r
  const summary = isError
    ? String(r.error)
    : r.status
      ? String(r.status)
      : r.count !== undefined
        ? `${r.count} result${r.count === 1 ? '' : 's'}`
        : 'Done'

  return { isError, summary, parsed: r }
}
