export const dynamic = 'force-dynamic'

/**
 * GET  /api/artifacts         — list artifacts for the authenticated gym
 * POST /api/artifacts         — create an artifact (used by agents/crons)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listArtifacts, createArtifact } from '@/lib/artifacts/db'
import type { ArtifactType } from '@/lib/artifacts/types'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) return NextResponse.json({ artifacts: [] })

  const artifacts = await listArtifacts(gym.id)
  return NextResponse.json({ artifacts })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) return NextResponse.json({ error: 'No gym connected' }, { status: 400 })

  const body = await req.json()
  const { artifactType, title, data, taskId, shareable } = body

  if (!artifactType || !title || !data) {
    return NextResponse.json({ error: 'artifactType, title, and data are required' }, { status: 400 })
  }

  const artifact = await createArtifact({
    gymId: gym.id,
    artifactType: artifactType as ArtifactType,
    title,
    data,
    taskId,
    createdBy: 'owner',
    shareable: shareable ?? true,
  })

  return NextResponse.json({ artifact })
}
