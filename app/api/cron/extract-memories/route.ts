export const dynamic = 'force-dynamic'

/**
 * GET|POST /api/cron/extract-memories
 *
 * Daily cron: scans recent conversations across all accounts and extracts
 * durable memory candidates using Haiku. Writes results to improvement_suggestions
 * for owner review (apply / dismiss).
 *
 * Sources:
 *   - gm_chat_messages (role = 'user') — owner messages to the GM agent
 *   - task_conversations (role = 'owner') — owner notes on individual tasks
 *
 * Consolidation:
 *   A second Haiku call compares candidates against existing memories. Candidates
 *   that extend an existing memory are marked with targetMemoryId so applying them
 *   updates the existing card rather than creating a new one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { extractMemoriesFromConversation, consolidateWithExisting } from '@/lib/memory-extractor'
import { getAccountMemories } from '@/lib/db/memories'

async function handler(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: accounts } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name')
    .not('pushpress_api_key', 'is', null)

  let totalExtracted = 0
  let accountsProcessed = 0

  for (const account of accounts ?? []) {
    try {
      // Owner messages to GM agent
      const { data: gmMessages } = await supabaseAdmin
        .from('gm_chat_messages')
        .select('role, content')
        .eq('account_id', account.id)
        .eq('role', 'user')
        .gte('created_at', since)
        .order('created_at', { ascending: true })

      // Owner notes on tasks
      const { data: taskMessages } = await supabaseAdmin
        .from('task_conversations')
        .select('role, content')
        .eq('account_id', account.id)
        .eq('role', 'owner')
        .gte('created_at', since)
        .order('created_at', { ascending: true })

      const allMessages = [
        ...(gmMessages ?? []).map(m => ({ role: 'owner (GM chat)', content: m.content })),
        ...(taskMessages ?? []).map(m => ({ role: 'owner (task note)', content: m.content })),
      ]

      if (allMessages.length === 0) continue

      const rawCandidates = await extractMemoriesFromConversation(allMessages, {
        accountName: account.account_name,
      })

      if (rawCandidates.length === 0) continue

      // Consolidate against existing memories (one Haiku call, cheap)
      const existingMemories = await getAccountMemories(account.id)
      const candidates = await consolidateWithExisting(
        rawCandidates,
        existingMemories.map(m => ({ id: m.id, content: m.content, category: m.category })),
      )

      // Dedupe: skip candidates whose content is already pending as a suggestion
      const { data: pendingSuggestions } = await supabaseAdmin
        .from('improvement_suggestions')
        .select('proposed_change')
        .eq('account_id', account.id)
        .eq('suggestion_type', 'memory')
        .eq('status', 'pending')

      const pendingContents = new Set(
        (pendingSuggestions ?? []).map(s =>
          (s.proposed_change as any)?.content?.toLowerCase()?.trim(),
        ),
      )

      const toInsert = candidates.filter(c => {
        const key = (c.mergedContent ?? c.content)?.toLowerCase()?.trim()
        return key && !pendingContents.has(key)
      })

      if (toInsert.length === 0) continue

      await supabaseAdmin.from('improvement_suggestions').insert(
        toInsert.map(c => {
          const displayContent = c.mergedContent ?? c.content
          return {
            account_id: account.id,
            suggestion_type: 'memory',
            title: displayContent.slice(0, 80),
            description: c.targetMemoryId
              ? `Suggested update to an existing memory. Evidence: "${c.evidence}"`
              : `Suggested from recent conversation. Evidence: "${c.evidence}"`,
            proposed_change: {
              content: displayContent,
              category: c.category ?? 'preference',
              scope: c.scope ?? 'global',
              importance: c.importance ?? 3,
              ...(c.targetMemoryId ? { targetMemoryId: c.targetMemoryId } : {}),
              ...(c.memberName ? { memberName: c.memberName } : {}),
            },
            evidence: {
              source: 'conversation_extraction',
              quote: c.evidence,
              originalContent: c.targetMemoryId ? c.content : undefined,
            },
            confidence_score: c.confidence ?? 0.7,
            evidence_strength:
              c.confidence >= 0.8 ? 'strong' : c.confidence >= 0.5 ? 'moderate' : 'weak',
            status: 'pending',
            privacy_tier: 'account_private',
            source: 'conversation_extraction',
            auto_apply_eligible: false,
          }
        }),
      )

      totalExtracted += toInsert.length
      accountsProcessed++
    } catch (err: any) {
      console.error(`[extract-memories] Failed for account ${account.id}:`, err?.message)
    }
  }

  console.log(
    `[extract-memories] Processed ${accountsProcessed} accounts, extracted ${totalExtracted} memory candidates`,
  )
  return NextResponse.json({ ok: true, accountsProcessed, totalExtracted })
}

export { handler as GET, handler as POST }
