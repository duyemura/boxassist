/**
 * Dashboard E2E Tests
 *
 * Tests the main dashboard page including:
 * - Retention scorecard rendering
 * - Approval queue interaction
 * - Activity feed rendering
 * - Navigation to members page
 *
 * Run: npm run test:e2e:headed (to watch in browser)
 * Requires: npm run dev running on localhost:3000
 */
import { test, expect } from '@playwright/test'

// Helper: match API routes by pathname (won't catch Next.js chunk/asset requests)
const api = (path: string) => (url: URL) => url.pathname === path || url.pathname.startsWith(path + '?')

// Mock API responses for deterministic tests
const MOCK_SCORECARD = {
  tasksCreated: 12,
  messagesSent: 18,
  membersRetained: 7,
  revenueRetained: 1050,
  membersChurned: 2,
  conversationsActive: 3,
  escalations: 1,
}

const MOCK_DASHBOARD = {
  user: { email: 'test@gym.com' },
  gym: { id: 'gym-1', gym_name: 'Test Gym', member_count: 120, autopilot_enabled: false },
  tier: 'pro',
  pendingActions: [
    {
      id: 'action-1',
      approved: null,
      dismissed: null,
      content: {
        memberId: 'member-1',
        memberName: 'Alex Martinez',
        memberEmail: 'alex@example.com',
        riskLevel: 'high',
        riskReason: 'No check-in for 14 days',
        recommendedAction: 'Send personal re-engagement email',
        draftedMessage: 'Hey Alex, we noticed you haven\'t been in lately. Everything OK?',
        messageSubject: 'Miss you at the gym',
        confidence: 85,
        insights: 'Member was attending 3x/week, dropped to 0',
        playbookName: 'At-Risk Monitor',
      },
    },
    {
      id: 'action-2',
      approved: null,
      dismissed: null,
      content: {
        memberId: 'member-2',
        memberName: 'Sarah Johnson',
        memberEmail: 'sarah@example.com',
        riskLevel: 'medium',
        riskReason: 'Attendance declining',
        recommendedAction: 'Check in with the member',
        draftedMessage: 'Hey Sarah, wanted to check in. How are things going?',
        messageSubject: 'Checking in',
        confidence: 72,
        insights: 'Down from 4x to 1x per week',
        playbookName: 'At-Risk Monitor',
      },
    },
  ],
  agents: [],
  recentRuns: [],
  monthlyRunCount: 5,
}

const MOCK_ACTIVITY = [
  { id: '1', type: 'outreach', memberName: 'Alex M.', detail: 'Reached out to Alex M.', outcome: null, createdAt: new Date().toISOString() },
  { id: '2', type: 'reply', memberName: 'Sarah K.', detail: 'Sarah replied: "Been traveling, back next week!"', outcome: null, createdAt: new Date().toISOString() },
  { id: '3', type: 'retained', memberName: 'Derek W.', detail: 'Derek checked in after outreach', outcome: 'engaged', createdAt: new Date(Date.now() - 86400000).toISOString() },
]

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Use URL predicate functions to match ONLY the API fetch, not Next.js chunks
    await page.route(api('/api/dashboard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DASHBOARD),
      })
    })

    await page.route(api('/api/retention/scorecard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SCORECARD),
      })
    })

    await page.route(api('/api/retention/activity'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ACTIVITY),
      })
    })
  })

  test('renders the retention scorecard with correct numbers', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for scorecard to load (replaces skeleton)
    await expect(page.getByText('MEMBERS RETAINED')).toBeVisible()
    await expect(page.getByText('REVENUE SAVED')).toBeVisible()
    await expect(page.getByText('CONVERSATIONS')).toBeVisible()
    await expect(page.getByText('NEEDS ATTENTION')).toBeVisible()

    // Check values
    await expect(page.getByText('7')).toBeVisible() // membersRetained
    await expect(page.getByText('$1,050')).toBeVisible() // revenueRetained
  })

  test('renders to-do list with pending actions', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for to-do list
    await expect(page.getByText('YOUR TO-DO')).toBeVisible()
    await expect(page.getByText('Alex Martinez')).toBeVisible()
    await expect(page.getByText('Sarah Johnson')).toBeVisible()

    // Check risk reasons shown as item subtitles
    await expect(page.getByText('No check-in for 14 days')).toBeVisible()
    await expect(page.getByText('Attendance declining')).toBeVisible()
  })

  test('mark done button sends API request', async ({ page }) => {
    let approveRequestMade = false

    await page.route(api('/api/autopilot/approve'), route => {
      approveRequestMade = true
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/dashboard')
    await expect(page.getByText('Alex Martinez')).toBeVisible()

    // Click the todo item to open the slide panel
    await page.getByText('Alex Martinez').click()

    // Click Mark Done in the slide panel
    await page.getByRole('button', { name: /Mark Done/i }).click()

    // Verify the API was called
    expect(approveRequestMade).toBe(true)
  })

  test('dismiss button sends dismiss API request', async ({ page }) => {
    let dismissRequestMade = false

    await page.route(api('/api/autopilot/dismiss'), route => {
      dismissRequestMade = true
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/dashboard')
    await expect(page.getByText('Alex Martinez')).toBeVisible()

    // Click the todo item to open the slide panel
    await page.getByText('Alex Martinez').click()

    // Click Dismiss in the slide panel
    await page.getByRole('button', { name: /Dismiss/i }).click()

    expect(dismissRequestMade).toBe(true)
  })

  test('shows empty state when no pending actions', async ({ page }) => {
    await page.route(api('/api/dashboard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_DASHBOARD, pendingActions: [] }),
      })
    })

    await page.goto('/dashboard')

    await expect(page.getByText('Nothing needs attention right now.')).toBeVisible()
  })

  test('renders activity feed', async ({ page }) => {
    await page.goto('/dashboard')

    // Activity feed should show recent events
    await expect(page.getByText('RECENT ACTIVITY')).toBeVisible()
    await expect(page.getByText(/Reached out to Alex/)).toBeVisible()
    await expect(page.getByText(/Sarah replied/)).toBeVisible()
  })

  test('navigates to members page from sidebar', async ({ page }) => {
    // Also mock the members API for the target page
    await page.route(api('/api/retention/members'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: '1', name: 'Derek Walsh', email: 'derek@example.com', riskLevel: 'high', lastCheckin: '12 days ago', status: 'awaiting_reply', outcome: null },
        ]),
      })
    })

    await page.goto('/dashboard')

    // Wait for dashboard to fully render
    await expect(page.getByText('MEMBERS RETAINED')).toBeVisible({ timeout: 10000 })

    // Click Members link using its unique href
    await page.getByTestId('desktop-nav').locator('a[href="/dashboard/members"]').click()

    await expect(page).toHaveURL(/\/dashboard\/members/)
  })
})
