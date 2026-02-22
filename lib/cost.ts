// Anthropic Claude pricing (per million tokens)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-3':  { input: 0.25, output: 1.25 },
  'default':         { input: 3.00, output: 15.00 },
}

const MARKUP = 1.3 // 30% markup

export function calcCost(
  inputTokens: number,
  outputTokens: number,
  model = 'default'
): { costUsd: number; markupUsd: number; billedUsd: number } {
  const p = PRICING[model] ?? PRICING.default
  const costUsd =
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output
  const billedUsd = costUsd * MARKUP
  const markupUsd = billedUsd - costUsd
  return { costUsd, markupUsd, billedUsd }
}

export function calcTimeSaved(messagesSent: number, minutesPerMessage = 5): number {
  return messagesSent * minutesPerMessage
}

export const TIME_VALUE_PER_HOUR = 40 // $40/hr default

export function timeSavedValue(minutes: number, hourlyRate = TIME_VALUE_PER_HOUR): number {
  return (minutes / 60) * hourlyRate
}
