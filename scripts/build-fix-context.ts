#!/usr/bin/env npx tsx
/**
 * build-fix-context.ts — Pre-analysis script for the autofix pipeline.
 *
 * Runs on GitHub Actions BEFORE Claude Code. Reads the investigation
 * comment from Linear (via /tmp/investigation.md), parses the FIX_BRIEF
 * YAML block, reads the actual source files from disk, and assembles a
 * compact context bundle that Claude Code can consume directly.
 *
 * This eliminates ~10 exploration turns from Claude Code's execution,
 * saving both time and tokens.
 *
 * Usage:
 *   npx tsx scripts/build-fix-context.ts /tmp/investigation.md /tmp/fix-context.md
 *
 * Input: investigation markdown (from fetch-investigation.ts)
 * Output: compact context bundle written to output path
 */

import * as fs from 'fs'
import * as path from 'path'

/** Parse the FIX_BRIEF YAML block from investigation text. */
export function parseFIXBRIEF(text: string): {
  target_files: string[]
  test_file: string | null
  area: string | null
  fix_approach: string | null
  red_test_sketch: string | null
  confidence: string | null
  risk_level: string | null
  risk_reason: string | null
} {
  const defaults = {
    target_files: [] as string[],
    test_file: null as string | null,
    area: null as string | null,
    fix_approach: null as string | null,
    red_test_sketch: null as string | null,
    confidence: null as string | null,
    risk_level: null as string | null,
    risk_reason: null as string | null,
  }

  const match = text.match(/<!-- FIX_BRIEF\n([\s\S]*?)END_FIX_BRIEF -->/)
  if (!match) return defaults

  const yaml = match[1]

  // Parse target_files (YAML list)
  const filesMatch = yaml.match(/target_files:\n((?:\s+-\s+.+\n?)+)/)
  if (filesMatch) {
    defaults.target_files = filesMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean)
  }

  // Parse simple key: value fields
  const simpleFields = ['test_file', 'area', 'confidence', 'risk_level', 'risk_reason'] as const
  for (const field of simpleFields) {
    const fieldMatch = yaml.match(new RegExp(`${field}:\\s*(.+)`))
    if (fieldMatch) {
      const value = fieldMatch[1].trim()
      if (value && value !== 'null') {
        (defaults as any)[field] = value.replace(/^["']|["']$/g, '')
      }
    }
  }

  // Parse multi-line YAML fields (using > folded style)
  const multiFields = ['fix_approach', 'red_test_sketch'] as const
  for (const field of multiFields) {
    const fieldMatch = yaml.match(new RegExp(`${field}:\\s*>\\n((?:\\s{2,}.+\\n?)+)`))
    if (fieldMatch) {
      (defaults as any)[field] = fieldMatch[1]
        .split('\n')
        .map((line: string) => line.replace(/^\s{2}/, ''))
        .join('\n')
        .trim()
    }
  }

  return defaults
}

/** Read a file from disk with truncation for very large files. */
function readFileWithLimit(filePath: string, maxLines: number = 300): string | null {
  try {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) return null

    const content = fs.readFileSync(resolved, 'utf8')
    const lines = content.split('\n')

    if (lines.length <= maxLines) return content

    const truncated = lines.slice(0, maxLines).join('\n')
    return truncated + `\n\n... (truncated at ${maxLines}/${lines.length} lines)`
  } catch {
    return null
  }
}

/** Build the context bundle from investigation text and local files. */
export function buildFixContext(investigationText: string): string {
  const brief = parseFIXBRIEF(investigationText)
  const parts: string[] = []

  // Header
  parts.push('# Fix Context Bundle')
  parts.push('')
  parts.push('This context was assembled by build-fix-context.ts from the AI investigation')
  parts.push('and actual source files. Use this to fix the bug — DO NOT explore the codebase.')
  parts.push('')

  // FIX_BRIEF summary
  if (brief.fix_approach) {
    parts.push('## Fix Approach')
    parts.push(brief.fix_approach)
    parts.push('')
  }

  if (brief.risk_level) {
    parts.push(`**Risk Level:** ${brief.risk_level}${brief.risk_reason ? ` (${brief.risk_reason})` : ''}`)
    parts.push(`**Confidence:** ${brief.confidence || 'unknown'}`)
    parts.push('')
  }

  // Target files — read actual content from disk
  if (brief.target_files.length > 0) {
    parts.push('## Target Files')
    parts.push('')
    for (const file of brief.target_files) {
      const content = readFileWithLimit(file)
      if (content) {
        parts.push(`### ${file}`)
        parts.push('```typescript')
        parts.push(content)
        parts.push('```')
        parts.push('')
      } else {
        parts.push(`### ${file}`)
        parts.push('_File not found on disk — may need to create it._')
        parts.push('')
      }
    }
  }

  // Test file — read if exists, include red test sketch if not
  if (brief.test_file) {
    const testContent = readFileWithLimit(brief.test_file)
    if (testContent) {
      parts.push(`## Existing Test File: ${brief.test_file}`)
      parts.push('```typescript')
      parts.push(testContent)
      parts.push('```')
      parts.push('')
    } else {
      parts.push(`## Test File: ${brief.test_file}`)
      parts.push('_Test file does not exist yet — create it._')
      parts.push('')
    }
  }

  if (brief.red_test_sketch) {
    parts.push('## Red Test Sketch')
    parts.push('```typescript')
    parts.push(brief.red_test_sketch)
    parts.push('```')
    parts.push('')
  }

  // Include the full investigation for reference
  parts.push('## Full Investigation')
  parts.push(investigationText)

  return parts.join('\n')
}

// ── CLI entry point ──────────────────────────────────────────────────────────

function main() {
  const [inputPath, outputPath] = [process.argv[2], process.argv[3]]

  if (!inputPath || !outputPath) {
    console.error('Usage: npx tsx scripts/build-fix-context.ts <input.md> <output.md>')
    process.exit(1)
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`)
    process.exit(1)
  }

  const investigation = fs.readFileSync(inputPath, 'utf8')
  const context = buildFixContext(investigation)

  fs.writeFileSync(outputPath, context, 'utf8')
  console.log(`[build-fix-context] Wrote ${context.length} chars to ${outputPath}`)

  // Extract and log risk level for the workflow to capture
  const brief = parseFIXBRIEF(investigation)
  if (brief.risk_level) {
    console.log(`RISK_LEVEL=${brief.risk_level}`)
  }
}

// Only run CLI when invoked directly (not when imported in tests)
const isDirectRun = process.argv[1]?.includes('build-fix-context')
if (isDirectRun) {
  main()
}
