/**
 * Artifact DB helpers — create, list, get, render-and-cache.
 */
import { supabaseAdmin } from '../supabase'
import { randomBytes } from 'crypto'
import type { Artifact, ArtifactType } from './types'
import { renderArtifact } from './render'

export async function createArtifact(params: {
  accountId: string
  artifactType: ArtifactType
  title: string
  data: Record<string, unknown>
  taskId?: string
  createdBy: string
  shareable?: boolean
}): Promise<Artifact> {
  // Render HTML at creation time
  const html = renderArtifact(params.artifactType, params.data)
  const shareToken = params.shareable ? randomBytes(16).toString('hex') : null

  const { data, error } = await supabaseAdmin
    .from('artifacts')
    .insert({
      account_id: params.accountId,
      artifact_type: params.artifactType,
      title: params.title,
      data: params.data,
      html,
      task_id: params.taskId ?? null,
      created_by: params.createdBy,
      share_token: shareToken,
    })
    .select('*')
    .single()

  if (error) throw new Error(`createArtifact failed: ${error.message}`)
  return data as Artifact
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const { data, error } = await supabaseAdmin
    .from('artifacts')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getArtifact failed: ${error.message}`)
  }
  return data as Artifact | null
}

export async function getArtifactByShareToken(token: string): Promise<Artifact | null> {
  const { data, error } = await supabaseAdmin
    .from('artifacts')
    .select('*')
    .eq('share_token', token)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getArtifactByShareToken failed: ${error.message}`)
  }
  return data as Artifact | null
}

export async function listArtifacts(accountId: string, limit = 20): Promise<Artifact[]> {
  const { data, error } = await supabaseAdmin
    .from('artifacts')
    .select('id, account_id, artifact_type, title, data, html, task_id, created_by, share_token, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`listArtifacts failed: ${error.message}`)
  return (data ?? []) as Artifact[]
}

/**
 * Re-render an artifact's HTML from its stored data.
 * Useful if the template changes and you want to update cached HTML.
 */
export async function reRenderArtifact(id: string): Promise<string | null> {
  const artifact = await getArtifact(id)
  if (!artifact) return null

  const html = renderArtifact(artifact.artifact_type as ArtifactType, artifact.data)

  await supabaseAdmin
    .from('artifacts')
    .update({ html })
    .eq('id', id)

  return html
}
