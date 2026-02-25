/**
 * GymAgents Workflow Runner
 * Executes goal-driven workflows step by step.
 * Each workflow_run tracks one member's progress toward a goal.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { sendEmail } from './resend'
import { HAIKU } from './models'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepKind = 'outreach' | 'wait' | 'branch' | 'integration' | 'internal_task' | 'owner_alert'

export interface WorkflowStep {
  id: string
  kind: StepKind
  config: Record<string, any>
  label?: string
}

export interface Workflow {
  id: string
  gym_id: string | null
  name: string
  goal: string
  steps: WorkflowStep[]
  timeout_days: number
}

export interface WorkflowRun {
  id: string
  workflow_id: string
  gym_id: string
  member_id: string
  member_email: string
  member_name: string
  status: 'active' | 'achieved' | 'failed' | 'timed_out' | 'paused'
  current_step: string
  goal: string
  context: Record<string, any>
  started_at: string
  action_id?: string
}

// ─── Start a new workflow run ─────────────────────────────────────────────────

export async function startWorkflowRun({
  workflowId,
  gymId,
  memberId,
  memberEmail,
  memberName,
  initialContext = {},
}: {
  workflowId: string
  gymId: string
  memberId: string
  memberEmail: string
  memberName: string
  initialContext?: Record<string, any>
}): Promise<WorkflowRun> {
  const { data: workflow } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', workflowId)
    .single()

  if (!workflow) throw new Error(`Workflow ${workflowId} not found`)

  const firstStep = (workflow.steps as WorkflowStep[])[0]
  if (!firstStep) throw new Error('Workflow has no steps')

  const { data: run, error } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      gym_id: gymId,
      member_id: memberId,
      member_email: memberEmail,
      member_name: memberName,
      status: 'active',
      current_step: firstStep.id,
      goal: workflow.goal,
      context: {
        ...initialContext,
        memberName,
        memberEmail,
        gymId,
      },
    })
    .select()
    .single()

  if (error || !run) throw new Error(`Failed to create workflow run: ${error?.message}`)

  await logEvent(run.id, firstStep.id, 'run_started', { workflowName: workflow.name })

  // Execute first step immediately
  await executeStep(run as WorkflowRun, firstStep, workflow as Workflow)

  return run as WorkflowRun
}

// ─── Execute a step ───────────────────────────────────────────────────────────

export async function executeStep(
  run: WorkflowRun,
  step: WorkflowStep,
  workflow: Workflow
): Promise<void> {
  await logEvent(run.id, step.id, 'step_started', { kind: step.kind, label: step.label })

  try {
    switch (step.kind) {
      case 'outreach':
        await executeOutreach(run, step, workflow)
        break
      case 'wait':
        await executeWait(run, step)
        break
      case 'branch':
        await executeBranch(run, step, workflow)
        break
      case 'integration':
        await executeIntegration(run, step, workflow)
        break
      case 'internal_task':
        await executeInternalTask(run, step)
        break
      case 'owner_alert':
        await executeOwnerAlert(run, step, workflow)
        break
      default:
        throw new Error(`Unknown step kind: ${(step as any).kind}`)
    }
  } catch (err: any) {
    await logEvent(run.id, step.id, 'step_failed', { error: err?.message })
    // Don't crash the run — let cron retry or escalate
  }
}

// ─── Step executors ───────────────────────────────────────────────────────────

async function executeOutreach(run: WorkflowRun, step: WorkflowStep, workflow: Workflow) {
  const cfg = step.config
  const gymName = run.context.gymName ?? 'the gym'

  // Draft message with Claude
  const draft = await draftOutreachMessage({
    goal: run.goal,
    memberName: run.member_name,
    gymName,
    stepPrompt: cfg.prompt_override,
    playbookGoal: cfg.playbook_goal,
    context: run.context,
    history: run.context.history ?? [],
  })

  const replyToken = `wf${run.id.replace(/-/g, '').slice(0, 16)}_${step.id}`

  // Send email
  const { error } = await sendEmail({
    to: run.member_email,
    subject: draft.subject,
    body: draft.body,
    replyTo: `reply+${replyToken}@lunovoria.resend.app`,
    gymName,
  })

  if (error) throw new Error(`Email send failed: ${error}`)

  // Create agent_action row for reply tracking
  const { data: action } = await supabase
    .from('agent_actions')
    .insert({
      action_type: 'workflow_outreach',
      content: {
        memberId: run.member_id,
        memberName: run.member_name,
        memberEmail: run.member_email,
        draftedMessage: draft.body,
        messageSubject: draft.subject,
        recommendedAction: run.goal,
        riskLevel: 'medium',
        _workflowRunId: run.id,
        _workflowStepId: step.id,
        _replyToken: replyToken,
        _gymId: run.gym_id,
        _gymName: gymName,
        _automationLevel: 'full_auto',
        _onReplyPositive: cfg.on_reply_positive ?? null,
        _onReplyNegative: cfg.on_reply_negative ?? null,
        _onNoReply: cfg.on_no_reply ?? null,
        _replyTimeoutDays: cfg.reply_timeout_days ?? 5,
      },
      pending_reply: true,
    })
    .select()
    .single()

  // Seed conversation row
  if (action) {
    await supabase.from('agent_conversations').insert({
      action_id: replyToken,
      gym_id: run.gym_id,
      role: 'outbound',
      text: draft.body,
      member_email: run.member_email,
      member_name: run.member_name,
    })

    // Link action to run
    await supabase
      .from('workflow_runs')
      .update({ action_id: action.id, status: 'active', current_step: step.id })
      .eq('id', run.id)
  }

  if (cfg.wait_for_reply) {
    // Pause here — reply webhook will advance the workflow
    await logEvent(run.id, step.id, 'outreach_sent', { replyToken, waitingForReply: true })
  } else {
    // Auto-advance to next step
    await logEvent(run.id, step.id, 'outreach_sent', { replyToken, waitingForReply: false })
    if (cfg.on_sent) await advanceRun(run, cfg.on_sent, workflow)
  }
}

async function executeWait(run: WorkflowRun, step: WorkflowStep) {
  const days = step.config.days ?? 1
  const resumeAt = new Date(Date.now() + days * 86_400_000).toISOString()

  await supabase.from('workflow_runs').update({
    status: 'paused',
    context: { ...run.context, _resumeAt: resumeAt, _resumeStep: step.config.then },
  }).eq('id', run.id)

  await logEvent(run.id, step.id, 'wait_started', { days, resumeAt, nextStep: step.config.then })
}

async function executeBranch(run: WorkflowRun, step: WorkflowStep, workflow: Workflow) {
  const cfg = step.config
  const branches: Array<{ label: string; next: string }> = cfg.branches ?? []

  // Ask Claude which branch to take based on context
  const contextSummary = JSON.stringify({
    goal: run.goal,
    memberName: run.member_name,
    history: run.context.history ?? [],
    notes: run.context.notes ?? [],
  }, null, 2)

  const branchList = branches.map((b, i) => `${i + 1}. ${b.label} → ${b.next}`).join('\n')

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 200,
    system: 'You are a workflow decision engine. Pick the best branch based on context. Respond with ONLY the next step ID, nothing else.',
    messages: [{
      role: 'user',
      content: `Goal: ${run.goal}\n\nQuestion: ${cfg.question}\n\nBranches:\n${branchList}\n\nContext:\n${contextSummary}\n\nWhich branch? Reply with just the step ID (e.g. "step_2").`
    }]
  })

  const chosen = (response.content[0] as any).text?.trim()
  const validBranch = branches.find(b => b.next === chosen)
  const nextStep = validBranch?.next ?? branches[branches.length - 1]?.next

  await logEvent(run.id, step.id, 'branch_taken', { question: cfg.question, chosen, label: validBranch?.label })
  await advanceRun(run, nextStep, workflow)
}

async function executeIntegration(run: WorkflowRun, step: WorkflowStep, workflow: Workflow) {
  const cfg = step.config

  switch (cfg.type) {
    case 'zapier':
    case 'make': {
      const webhookUrl = cfg.webhook_url
      if (!webhookUrl) throw new Error('No webhook_url configured')
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowRunId: run.id,
          gymId: run.gym_id,
          memberId: run.member_id,
          memberEmail: run.member_email,
          memberName: run.member_name,
          goal: run.goal,
          stepId: step.id,
          ...cfg.payload,
        }),
      })
      break
    }

    case 'pushpress_tag': {
      // Will call PushPress API to tag the member
      // For now, log it — PushPress API integration TBD
      console.log(`[workflow] pushpress_tag: ${cfg.tag} → ${run.member_email}`)
      break
    }

    case 'slack_notify': {
      // Notify gym owner via Slack
      console.log(`[workflow] slack_notify: ${cfg.message} → ${run.gym_id}`)
      break
    }
  }

  await logEvent(run.id, step.id, 'integration_fired', { type: cfg.type })
  if (cfg.on_sent) await advanceRun(run, cfg.on_sent, workflow)
}

async function executeInternalTask(run: WorkflowRun, step: WorkflowStep) {
  const cfg = step.config
  const title = interpolate(cfg.title ?? 'Task', run)

  // Create an agent_action row so it surfaces in the dashboard
  await supabase.from('agent_actions').insert({
    action_type: 'workflow_task',
    content: {
      memberId: run.member_id,
      memberName: run.member_name,
      memberEmail: run.member_email,
      actionKind: 'internal_task',
      draftedMessage: title,
      messageSubject: title,
      recommendedAction: title,
      riskLevel: 'medium',
      _workflowRunId: run.id,
      _workflowStepId: step.id,
      _onDone: cfg.on_done,
    },
    needs_review: true,
    review_reason: 'Workflow task requires owner action',
  })

  await logEvent(run.id, step.id, 'task_created', { title })
  // Pauses until owner marks done — done via /api/workflow-runs/advance
}

async function executeOwnerAlert(run: WorkflowRun, step: WorkflowStep, workflow: Workflow) {
  const cfg = step.config
  const message = interpolate(cfg.message ?? 'Workflow update', run)

  // For now, log alert — future: Slack/email to owner
  console.log(`[workflow] owner_alert [${run.gym_id}]: ${message}`)

  await logEvent(run.id, step.id, 'owner_alerted', { message })
  if (cfg.on_sent) await advanceRun(run, cfg.on_sent, workflow)
}

// ─── Advance run to next step ─────────────────────────────────────────────────

export async function advanceRun(
  run: WorkflowRun,
  nextStepId: string,
  workflow: Workflow
): Promise<void> {
  if (nextStepId === 'goal_achieved') {
    await supabase.from('workflow_runs').update({
      status: 'achieved',
      achieved_at: new Date().toISOString(),
      current_step: 'goal_achieved',
    }).eq('id', run.id)
    await logEvent(run.id, 'goal_achieved', 'goal_achieved', {})
    return
  }

  if (nextStepId === 'give_up' || nextStepId === 'failed') {
    await supabase.from('workflow_runs').update({ status: 'failed', current_step: nextStepId }).eq('id', run.id)
    await logEvent(run.id, nextStepId, 'run_failed', {})
    return
  }

  const nextStep = (workflow.steps as WorkflowStep[]).find(s => s.id === nextStepId)
  if (!nextStep) {
    console.error(`[workflow] step ${nextStepId} not found in workflow ${workflow.id}`)
    return
  }

  await supabase.from('workflow_runs').update({
    current_step: nextStepId,
    status: 'active',
  }).eq('id', run.id)

  const updatedRun = { ...run, current_step: nextStepId, status: 'active' as const }
  await executeStep(updatedRun, nextStep, workflow)
}

// ─── Called by reply-agent when a reply arrives on a workflow outreach ─────────

export async function handleWorkflowReply({
  runId,
  stepId,
  replyText,
  sentiment, // 'positive' | 'negative' | 'neutral'
}: {
  runId: string
  stepId: string
  replyText: string
  sentiment: 'positive' | 'negative' | 'neutral'
}): Promise<void> {
  const { data: run } = await supabase
    .from('workflow_runs')
    .select('*, workflows(*)')
    .eq('id', runId)
    .single()

  if (!run || run.status !== 'active') return

  const workflow = run.workflows as Workflow
  const step = (workflow.steps as WorkflowStep[]).find(s => s.id === stepId)
  if (!step) return

  // Update context with reply history
  const history = run.context.history ?? []
  history.push({ role: 'inbound', text: replyText, at: new Date().toISOString() })
  await supabase.from('workflow_runs').update({
    context: { ...run.context, history },
  }).eq('id', run.id)

  await logEvent(run.id, stepId, 'reply_received', { sentiment, text: replyText.slice(0, 200) })

  // Determine next step based on sentiment
  const cfg = step.config
  let nextStep: string | null = null
  if (sentiment === 'positive' && cfg.on_reply_positive) nextStep = cfg.on_reply_positive
  else if (sentiment === 'negative' && cfg.on_reply_negative) nextStep = cfg.on_reply_negative
  else if (cfg.on_reply_positive) nextStep = cfg.on_reply_positive // default to positive path

  if (nextStep) await advanceRun(run as WorkflowRun, nextStep, workflow)
}

// ─── Cron: advance paused/timed-out runs ──────────────────────────────────────

export async function tickWorkflows(gymId?: string): Promise<void> {
  const now = new Date().toISOString()

  // Resume paused runs whose wait has elapsed
  const pausedQuery = supabase
    .from('workflow_runs')
    .select('*, workflows(*)')
    .eq('status', 'paused')

  if (gymId) pausedQuery.eq('gym_id', gymId)

  const { data: pausedRuns } = await pausedQuery

  for (const run of pausedRuns ?? []) {
    const resumeAt = run.context?._resumeAt
    const resumeStep = run.context?._resumeStep
    if (!resumeAt || !resumeStep) continue
    if (now < resumeAt) continue

    const workflow = run.workflows as Workflow
    await supabase.from('workflow_runs').update({
      status: 'active',
      context: { ...run.context, _resumeAt: undefined, _resumeStep: undefined },
    }).eq('id', run.id)

    await advanceRun(run as WorkflowRun, resumeStep, workflow)
  }

  // Time out stalled runs
  const { data: allWorkflows } = await supabase.from('workflows').select('id, timeout_days')
  const timeoutMap = Object.fromEntries((allWorkflows ?? []).map(w => [w.id, w.timeout_days ?? 30]))

  const { data: activeRuns } = await supabase
    .from('workflow_runs')
    .select('id, workflow_id, started_at')
    .eq('status', 'active')

  for (const run of activeRuns ?? []) {
    const timeoutDays = timeoutMap[run.workflow_id] ?? 30
    const cutoff = new Date(run.started_at)
    cutoff.setDate(cutoff.getDate() + timeoutDays)
    if (new Date() > cutoff) {
      await supabase.from('workflow_runs').update({ status: 'timed_out' }).eq('id', run.id)
      await logEvent(run.id, 'timeout', 'run_timed_out', { timeoutDays })
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logEvent(runId: string, stepId: string, eventType: string, payload: Record<string, any>) {
  await supabase.from('workflow_events').insert({ run_id: runId, step_id: stepId, event_type: eventType, payload })
}

function interpolate(template: string, run: WorkflowRun): string {
  return template
    .replace(/\{memberName\}/g, run.member_name)
    .replace(/\{memberEmail\}/g, run.member_email)
    .replace(/\{goal\}/g, run.goal)
    .replace(/\{gymId\}/g, run.gym_id)
}

async function draftOutreachMessage({
  goal, memberName, gymName, stepPrompt, playbookGoal, context, history,
}: {
  goal: string
  memberName: string
  gymName: string
  stepPrompt?: string
  playbookGoal?: string
  context: Record<string, any>
  history: Array<{ role: string; text: string }>
}): Promise<{ subject: string; body: string }> {
  const historyText = history.length > 0
    ? '\n\nConversation so far:\n' + history.map(m => `${m.role === 'outbound' ? 'Agent' : memberName}: ${m.text}`).join('\n')
    : ''

  const prompt = stepPrompt ?? `Write a warm, personal message to ${memberName} as part of this goal: ${goal}. ${playbookGoal ?? ''}`

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 600,
    system: `You are a retention agent for ${gymName}. Write short, warm, personal messages. Never sound like a template. Always use first name. 3-4 sentences max.`,
    messages: [{
      role: 'user',
      content: `${prompt}${historyText}\n\nRespond with JSON: { "subject": "...", "body": "..." }`
    }]
  })

  const text = (response.content[0] as any).text?.trim() ?? ''
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch {}
  return { subject: `Hey ${memberName}`, body: text }
}
