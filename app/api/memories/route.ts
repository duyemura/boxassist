export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getGymMemories, createMemory } from '@/lib/db/memories'
import type { MemoryCategory } from '@/lib/db/memories'

const VALID_CATEGORIES: MemoryCategory[] = ['preference', 'member_fact', 'gym_context', 'learned_pattern']

/**
 * GET /api/memories — list all active memories for the authenticated gym
 */
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ memories: [] })
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const category = req.nextUrl.searchParams.get('category') as MemoryCategory | null
  const memberId = req.nextUrl.searchParams.get('memberId') ?? undefined

  const memories = await getGymMemories(gym.id, {
    category: category ?? undefined,
    memberId,
  })

  return NextResponse.json({ memories })
}

/**
 * POST /api/memories — create a new memory
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const body = await req.json()
  const { content, category, importance, scope, memberId } = body

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 },
    )
  }

  if (importance !== undefined && (typeof importance !== 'number' || importance < 1 || importance > 5)) {
    return NextResponse.json({ error: 'importance must be 1-5' }, { status: 400 })
  }

  const memory = await createMemory({
    gymId: gym.id,
    category,
    content: content.trim(),
    importance: importance ?? 3,
    scope: scope ?? 'global',
    memberId,
    source: 'owner',
  })

  return NextResponse.json({ memory }, { status: 201 })
}

/**
 * DELETE /api/memories — deactivate a memory by id (soft delete)
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((session as any).isDemo) {
    return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  const { id } = await req.json()
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  // Verify the memory belongs to this gym
  const { data: memory } = await supabaseAdmin
    .from('gym_memories')
    .select('id, gym_id')
    .eq('id', id)
    .single()

  if (!memory || memory.gym_id !== gym.id) {
    return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  }

  await supabaseAdmin
    .from('gym_memories')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
