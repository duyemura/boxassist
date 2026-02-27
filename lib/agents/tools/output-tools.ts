/**
 * Output tools — produce documents and artifacts.
 *
 * Never require approval (creating a document is safe — sending/sharing
 * it is a separate action via action tools).
 */

import type { AgentTool, ToolGroup } from './types'
import { supabaseAdmin } from '../../supabase'

// ── create_artifact ─────────────────────────────────────────────────────

const createArtifact: AgentTool = {
  name: 'create_artifact',
  description: 'Create a rich HTML report (retention summary, ROI card, member plan, etc.). Returns an artifact ID and share URL.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Artifact title.' },
      artifact_type: {
        type: 'string',
        description: 'Type of artifact (e.g. retention_report, roi_card, member_plan, custom).',
      },
      html_content: { type: 'string', description: 'HTML content of the artifact.' },
      summary: { type: 'string', description: 'Brief plain-text summary of what this artifact contains.' },
    },
    required: ['title', 'artifact_type', 'html_content'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx) {
    try {
      const { data, error } = await supabaseAdmin
        .from('artifacts')
        .insert({
          account_id: ctx.accountId,
          title: input.title,
          artifact_type: input.artifact_type,
          data: {
            html: input.html_content,
            summary: input.summary ?? null,
          },
          session_id: ctx.sessionId,
        })
        .select('id')
        .single()

      if (error) return { error: `Failed to create artifact: ${error.message}` }

      return {
        artifactId: data.id,
        title: input.title,
        status: 'created',
      }
    } catch (err: any) {
      return { error: `Failed to create artifact: ${err.message}` }
    }
  },
}

// ── create_markdown ─────────────────────────────────────────────────────

const createMarkdown: AgentTool = {
  name: 'create_markdown',
  description: 'Create a markdown document and store it. Can be rendered in the dashboard or shared.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Document title.' },
      content: { type: 'string', description: 'Markdown content.' },
    },
    required: ['title', 'content'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx) {
    try {
      const { data, error } = await supabaseAdmin
        .from('artifacts')
        .insert({
          account_id: ctx.accountId,
          title: input.title,
          artifact_type: 'markdown',
          data: {
            content: input.content,
          },
          session_id: ctx.sessionId,
        })
        .select('id')
        .single()

      if (error) return { error: `Failed to create document: ${error.message}` }

      return {
        artifactId: data.id,
        title: input.title,
        status: 'created',
      }
    } catch (err: any) {
      return { error: `Failed to create document: ${err.message}` }
    }
  },
}

// ── Tool group ──────────────────────────────────────────────────────────

export const outputToolGroup: ToolGroup = {
  name: 'output',
  tools: [createArtifact, createMarkdown],
}
