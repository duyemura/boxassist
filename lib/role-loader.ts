/**
 * role-loader.ts — Loads role definition files at runtime.
 *
 * Role files live in lib/roles/ as Markdown with YAML front-matter.
 * A role is the identity layer of an agent session — it tells the AI
 * who it is, what it can do, and when to escalate.
 *
 * Role files are Layer 0 of the prompt stack:
 *   Layer 0: Role identity (from this loader)
 *   Layer 1: Base context (from skill-loader)
 *   Layer 2: Relevant skills (situational)
 *   Layer 3: Business memories
 *   Layer 4: Mode instructions
 */

import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { parseSkillFrontMatter } from './skill-loader'

const ROLES_DIR = join(process.cwd(), 'lib', 'roles')

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoleDefinition {
  id: string
  title: string
  reportsTo: string
  escalateTo: string
  channels: string[]
  directs: string[]
  defaultAutonomy: string
  body: string // full Markdown content after front-matter
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const roleCache = new Map<string, RoleDefinition | null>()

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load a role definition by ID. Returns null if the role file doesn't exist.
 * Results are cached in-process.
 */
export async function loadRole(roleId: string): Promise<RoleDefinition | null> {
  if (roleCache.has(roleId)) return roleCache.get(roleId)!

  try {
    const content = await readFile(join(ROLES_DIR, `${roleId}.md`), 'utf-8')
    const { meta, body } = parseSkillFrontMatter(content)

    const role: RoleDefinition = {
      id: (meta.id as string) ?? roleId,
      title: (meta.title as string) ?? roleId,
      reportsTo: (meta.reports_to as string) ?? 'owner',
      escalateTo: (meta.escalate_to as string) ?? 'owner',
      channels: Array.isArray(meta.channels) ? meta.channels : [],
      directs: Array.isArray(meta.directs) ? meta.directs : [],
      defaultAutonomy: (meta.default_autonomy as string) ?? 'semi_auto',
      body,
    }

    roleCache.set(roleId, role)
    return role
  } catch {
    roleCache.set(roleId, null)
    return null
  }
}

/**
 * List all available role IDs by scanning the roles directory.
 */
export async function listRoles(): Promise<string[]> {
  try {
    const files = await readdir(ROLES_DIR)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  } catch {
    return []
  }
}

/**
 * Build the role identity prompt section.
 * This becomes Layer 0 of the system prompt — before base context, skills, or memories.
 */
export function buildRolePrompt(role: RoleDefinition): string {
  const header = [
    `# Your Role: ${role.title}`,
    '',
    `You report to: ${role.reportsTo}`,
    `Escalate to: ${role.escalateTo}`,
    role.channels.length > 0 ? `Channels you handle: ${role.channels.join(', ')}` : '',
    role.directs.length > 0 ? `You direct: ${role.directs.join(', ')}` : '',
    '',
  ].filter(Boolean).join('\n')

  return header + role.body
}
