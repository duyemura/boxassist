export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { loadSkillIndex } from '@/lib/skill-loader'
import {
  listSkillCustomizations,
  upsertSkillCustomization,
  deleteSkillCustomization,
} from '@/lib/db/skill-customizations'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ skills: [] })

  const [skills, customizations] = await Promise.all([
    loadSkillIndex(),
    listSkillCustomizations(account.id),
  ])

  const customMap = new Map(customizations.map(c => [c.skill_id, c]))

  const result = skills
    .filter(s => s.id !== '_base')
    .map(s => ({
      id: s.id,
      filename: s.filename,
      domain: s.domain,
      applies_when: s.applies_when,
      triggers: s.triggers,
      body: s.body,
      customization: customMap.get(s.id) ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return NextResponse.json({ skills: result })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 404 })

  const { skillId, notes } = await req.json()
  if (!skillId || typeof skillId !== 'string')
    return NextResponse.json({ error: 'skillId required' }, { status: 400 })
  if (!notes || typeof notes !== 'string' || !notes.trim())
    return NextResponse.json({ error: 'notes required' }, { status: 400 })

  const customization = await upsertSkillCustomization(account.id, skillId, notes.trim())
  return NextResponse.json({ customization })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 404 })

  const { skillId } = await req.json()
  if (!skillId) return NextResponse.json({ error: 'skillId required' }, { status: 400 })

  await deleteSkillCustomization(account.id, skillId)
  return NextResponse.json({ ok: true })
}
