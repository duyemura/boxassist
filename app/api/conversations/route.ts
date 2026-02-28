export const dynamic = 'force-dynamic'

/**
 * GET /api/conversations
 *
 * Returns conversations for the authenticated user's account.
 *
 * Query params:
 *   status  — filter by status: open, resolved, escalated, waiting_member, waiting_agent
 *   role    — filter by assigned role: front_desk, gm
 *   limit   — max results (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { getConversations, type ConversationStatus } from '@/lib/db/conversations'

const VALID_STATUSES: ConversationStatus[] = ['open', 'resolved', 'escalated', 'waiting_member', 'waiting_agent']

export async function GET(req: NextRequest) {
  // Auth
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const account = await getAccountForUser(session.id)
  if (!account) {
    return NextResponse.json({ conversations: [] })
  }

  // Parse query params
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const roleParam = searchParams.get('role')
  const limitParam = searchParams.get('limit')

  // Validate status
  let status: ConversationStatus | undefined
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam as ConversationStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }
    status = statusParam as ConversationStatus
  }

  // Validate limit
  const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 100)

  try {
    const conversations = await getConversations(account.id as string, {
      status,
      assignedRole: roleParam ?? undefined,
      limit,
    })

    return NextResponse.json({ conversations })
  } catch (err: any) {
    console.error('[conversations-api] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch conversations' },
      { status: 500 },
    )
  }
}
