/**
 * backfill-phase1.ts
 *
 * One-shot migration script: copies legacy agent_actions and agent_conversations
 * into the new agent_tasks and task_conversations tables.
 *
 * Run with:
 *   npx ts-node --project tsconfig.json scripts/backfill-phase1.ts
 *
 * Safe to re-run: skips tasks/conversations that already exist.
 * Logs progress to stdout and errors to stderr.
 */

// Load env vars from .env.local for local execution
// Install dotenv if needed: npm install --save-dev dotenv @types/dotenv
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv')
  dotenv.config({ path: '.env.local' })
} catch {
  // dotenv not installed — expect env vars to be set externally
}

import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Fixed demo gym UUID — matches the row inserted by migration 001
const DEMO_GYM_ID = '00000000-0000-0000-0000-000000000001'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveGymId(rawGymId: string | null | undefined): string {
  if (!rawGymId || rawGymId === 'demo') return DEMO_GYM_ID
  // If it looks like a UUID, use it; otherwise fall back to demo
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidPattern.test(rawGymId) ? rawGymId : DEMO_GYM_ID
}

function mapLegacyRole(role: string): 'agent' | 'member' | 'system' {
  if (role === 'outbound') return 'agent'
  if (role === 'inbound') return 'member'
  // 'agent_decision' and anything else → system
  return 'system'
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Backfill agent_tasks from agent_actions
// ─────────────────────────────────────────────────────────────────────────────

async function backfillTasks(): Promise<Map<string, string>> {
  // Returns: Map<legacy_action_id, task_id>

  console.log('\n📋  Step 1: Backfilling agent_tasks from agent_actions...')

  // Load all existing legacy_action_id mappings so we can skip already-migrated rows
  const { data: existingTasks, error: existingErr } = await db
    .from('agent_tasks')
    .select('id, legacy_action_id')
    .not('legacy_action_id', 'is', null)

  if (existingErr) {
    console.error('  ❌  Failed to load existing agent_tasks:', existingErr.message)
    process.exit(1)
  }

  const alreadyMigrated = new Map<string, string>()
  for (const t of existingTasks ?? []) {
    if (t.legacy_action_id) alreadyMigrated.set(t.legacy_action_id, t.id)
  }
  console.log(`  ℹ️   ${alreadyMigrated.size} tasks already migrated — will skip`)

  // Fetch all agent_actions
  const { data: actions, error: actionsErr } = await db
    .from('agent_actions')
    .select('*')
    .order('created_at', { ascending: true })

  if (actionsErr) {
    console.error('  ❌  Failed to load agent_actions:', actionsErr.message)
    process.exit(1)
  }

  console.log(`  📥  Found ${actions?.length ?? 0} agent_actions`)

  const actionToTaskId = new Map<string, string>(alreadyMigrated)
  let created = 0
  let skipped = 0
  let errors = 0

  for (const action of actions ?? []) {
    // Skip if already migrated
    if (alreadyMigrated.has(action.id)) {
      skipped++
      continue
    }

    const content = action.content ?? {}
    const gymId = resolveGymId(content._gymId)
    const goal =
      content.recommendedAction ??
      content.playbookGoal ??
      `Legacy action: ${action.action_type}`

    try {
      const { data: newTask, error: insertErr } = await db
        .from('agent_tasks')
        .insert({
          gym_id: gymId,
          assigned_agent: 'retention',
          created_by_agent: 'gm',
          task_type: action.action_type ?? 'manual',
          member_email: content.memberEmail ?? null,
          member_name: content.memberName ?? null,
          goal,
          context: {
            legacyAction: true,
            originalContent: content,
            automationLevel: content._automationLevel ?? null,
          },
          status: action.resolved_at
            ? 'resolved'
            : action.dismissed
            ? 'cancelled'
            : 'open',
          requires_approval: action.needs_review ?? false,
          outcome_score: action.outcome_score ?? null,
          outcome_reason: action.outcome_reason ?? null,
          resolved_at: action.resolved_at ?? null,
          legacy_action_id: action.id,
          created_at: action.created_at,
          updated_at: action.created_at,
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error(`  ❌  Failed to insert task for action ${action.id}:`, insertErr.message)
        errors++
        continue
      }

      actionToTaskId.set(action.id, newTask.id)
      created++

      if (created % 10 === 0) {
        process.stdout.write(`  ✅  ${created} tasks created...\r`)
      }
    } catch (err) {
      console.error(`  ❌  Unexpected error for action ${action.id}:`, err)
      errors++
    }
  }

  console.log(`\n  ✅  Step 1 done: ${created} created, ${skipped} skipped, ${errors} errors`)
  return actionToTaskId
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Backfill task_conversations from agent_conversations
// ─────────────────────────────────────────────────────────────────────────────

async function backfillConversations(actionToTaskId: Map<string, string>): Promise<void> {
  console.log('\n💬  Step 2: Backfilling task_conversations from agent_conversations...')

  // Load existing task_conversation task_ids to detect already-migrated rows
  // We use a composite approach: load all existing (task_id, created_at) pairs
  const { data: existingConvos, error: existingErr } = await db
    .from('task_conversations')
    .select('task_id, created_at')

  if (existingErr) {
    console.error('  ❌  Failed to load existing task_conversations:', existingErr.message)
    return
  }

  const existingKeys = new Set<string>()
  for (const c of existingConvos ?? []) {
    existingKeys.add(`${c.task_id}::${c.created_at}`)
  }
  console.log(`  ℹ️   ${existingKeys.size} conversation rows already migrated — will skip`)

  // Load all agent_conversations
  const { data: convos, error: convosErr } = await db
    .from('agent_conversations')
    .select('*')
    .order('created_at', { ascending: true })

  if (convosErr) {
    console.error('  ❌  Failed to load agent_conversations:', convosErr.message)
    return
  }

  console.log(`  📥  Found ${convos?.length ?? 0} agent_conversations`)

  let inserted = 0
  let skipped = 0
  let unmatched = 0
  let errors = 0

  // agent_conversations.action_id is the replyToken string, which might be a UUID or a demo token
  // We need to find the task_id for each action_id
  // Build a reverse map: replyToken → task_id (via agent_actions.content->_replyToken)
  const tokenToTaskId = new Map<string, string>()

  // For UUID action_ids, actionToTaskId already covers them directly
  // For demo token action_ids (e.g. "demo-xxx"), we need to look up via agent_actions.content->_replyToken
  // Load all agent_actions to build the replyToken → action.id map
  const { data: allActions } = await db
    .from('agent_actions')
    .select('id, content')

  for (const action of allActions ?? []) {
    const token = action.content?._replyToken
    if (token && actionToTaskId.has(action.id)) {
      tokenToTaskId.set(token, actionToTaskId.get(action.id)!)
    }
    // Also map the action.id itself directly
    if (actionToTaskId.has(action.id)) {
      tokenToTaskId.set(action.id, actionToTaskId.get(action.id)!)
    }
  }

  for (const convo of convos ?? []) {
    const actionId = convo.action_id
    const taskId = tokenToTaskId.get(actionId) ?? actionToTaskId.get(actionId)

    if (!taskId) {
      // No matching task — this action_id wasn't in agent_actions
      unmatched++
      continue
    }

    const gymId = resolveGymId(convo.gym_id)
    const role = mapLegacyRole(convo.role)
    const content =
      role === 'system' && convo.role === 'agent_decision'
        ? `[legacy decision] ${convo.text}`
        : convo.text ?? ''

    // Check if already migrated
    const key = `${taskId}::${convo.created_at}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }

    try {
      let evaluation: Record<string, unknown> | null = null
      if (convo.role === 'agent_decision') {
        try {
          evaluation = JSON.parse(convo.text)
        } catch {
          // Not valid JSON — skip eval
        }
      }

      const { error: insertErr } = await db.from('task_conversations').insert({
        task_id: taskId,
        gym_id: gymId,
        role,
        content,
        agent_name: role === 'agent' ? 'retention' : null,
        evaluation,
        created_at: convo.created_at,
      })

      if (insertErr) {
        console.error(
          `  ❌  Failed to insert conversation for task ${taskId} (action ${actionId}):`,
          insertErr.message,
        )
        errors++
        continue
      }

      inserted++
      if (inserted % 25 === 0) {
        process.stdout.write(`  ✅  ${inserted} conversations inserted...\r`)
      }
    } catch (err) {
      console.error(`  ❌  Unexpected error for conversation action_id=${actionId}:`, err)
      errors++
    }
  }

  console.log(
    `\n  ✅  Step 2 done: ${inserted} inserted, ${skipped} skipped, ${unmatched} unmatched, ${errors} errors`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  GymAgents Phase 1 Backfill')
  console.log('================================')
  console.log(`   Supabase: ${SUPABASE_URL}`)
  console.log(`   Demo gym: ${DEMO_GYM_ID}`)

  const actionToTaskId = await backfillTasks()
  await backfillConversations(actionToTaskId)

  console.log('\n🎉  Backfill complete!')
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err)
  process.exit(1)
})
