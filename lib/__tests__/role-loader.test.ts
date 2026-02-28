/**
 * Tests for role-loader.ts
 */

import { describe, it, expect } from 'vitest'
import { loadRole, listRoles, buildRolePrompt } from '../role-loader'

describe('loadRole', () => {
  it('loads the front-desk role file', async () => {
    const role = await loadRole('front-desk')
    expect(role).not.toBeNull()
    expect(role!.id).toBe('front-desk')
    expect(role!.title).toBe('Front Desk Agent')
    expect(role!.reportsTo).toBe('gm')
    expect(role!.escalateTo).toBe('gm')
    expect(role!.channels).toContain('email')
    expect(role!.channels).toContain('sms')
    expect(role!.defaultAutonomy).toBe('semi_auto')
    expect(role!.body).toContain('Front Desk Agent')
  })

  it('loads the gm role file', async () => {
    const role = await loadRole('gm')
    expect(role).not.toBeNull()
    expect(role!.id).toBe('gm')
    expect(role!.title).toBe('General Manager Agent')
    expect(role!.reportsTo).toBe('owner')
    expect(role!.directs).toContain('front-desk')
    expect(role!.body).toContain('General Manager')
  })

  it('returns null for nonexistent role', async () => {
    const role = await loadRole('nonexistent-role-xyz')
    expect(role).toBeNull()
  })

  it('caches role on second load', async () => {
    const role1 = await loadRole('front-desk')
    const role2 = await loadRole('front-desk')
    expect(role1).toBe(role2) // same reference = from cache
  })
})

describe('listRoles', () => {
  it('returns at least front-desk and gm', async () => {
    const roles = await listRoles()
    expect(roles).toContain('front-desk')
    expect(roles).toContain('gm')
  })
})

describe('buildRolePrompt', () => {
  it('builds a prompt with header and body', async () => {
    const role = await loadRole('front-desk')
    expect(role).not.toBeNull()

    const prompt = buildRolePrompt(role!)
    expect(prompt).toContain('# Your Role: Front Desk Agent')
    expect(prompt).toContain('You report to: gm')
    expect(prompt).toContain('Escalate to: gm')
    expect(prompt).toContain('Channels you handle:')
    // Body content should be present
    expect(prompt).toContain('You are the front desk')
  })

  it('includes directs for GM role', async () => {
    const role = await loadRole('gm')
    expect(role).not.toBeNull()

    const prompt = buildRolePrompt(role!)
    expect(prompt).toContain('You direct: front-desk')
  })
})
