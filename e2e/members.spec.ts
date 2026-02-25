/**
 * Members Page E2E Tests
 *
 * Tests the /dashboard/members page:
 * - Member list rendering
 * - Filter tabs (All, At Risk, Active, Retained)
 * - Risk level indicators
 * - Status badges
 *
 * Run: npm run test:e2e:headed
 * Requires: npm run dev running on localhost:3000
 */
import { test, expect } from '@playwright/test'

// Helper: match API routes by pathname (won't catch Next.js chunk/asset requests)
const api = (path: string) => (url: URL) => url.pathname === path || url.pathname.startsWith(path + '?')

const MOCK_MEMBERS = [
  { id: '1', name: 'Derek Walsh', email: 'derek@example.com', riskLevel: 'high', lastCheckin: '12 days ago', status: 'awaiting_reply', outcome: null },
  { id: '2', name: 'Priya Patel', email: 'priya@example.com', riskLevel: 'medium', lastCheckin: '8 days ago', status: 'open', outcome: null },
  { id: '3', name: 'Alex Martinez', email: 'alex@example.com', riskLevel: 'high', lastCheckin: '19 days ago', status: 'resolved', outcome: 'engaged' },
  { id: '4', name: 'Sarah Johnson', email: 'sarah@example.com', riskLevel: 'medium', lastCheckin: '6 days ago', status: null, outcome: null },
  { id: '5', name: 'Mike Torres', email: 'mike@example.com', riskLevel: 'high', lastCheckin: '25 days ago', status: 'resolved', outcome: 'churned' },
]

test.describe('Members Page', () => {
  test.beforeEach(async ({ page }) => {
    // DashboardShell fetches /api/dashboard for the chrome
    await page.route(api('/api/dashboard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { email: 'test@gym.com' }, gym: { id: 'gym-1', gym_name: 'Test Gym', member_count: 120 }, pendingActions: [], agents: [], recentRuns: [], tier: 'pro' }),
      })
    })

    await page.route(api('/api/retention/members'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MEMBERS),
      })
    })
  })

  test('renders the member list', async ({ page }) => {
    await page.goto('/dashboard/members')

    // .last() targets visible desktop element (AppShell renders children twice: mobile + desktop)
    await expect(page.getByText('Derek Walsh').last()).toBeVisible()
    await expect(page.getByText('Priya Patel').last()).toBeVisible()
    await expect(page.getByText('Alex Martinez').last()).toBeVisible()
    await expect(page.getByText('Mike Torres').last()).toBeVisible()
  })

  test('shows filter tabs', async ({ page }) => {
    await page.goto('/dashboard/members')

    await expect(page.getByRole('button', { name: /All/i }).last()).toBeVisible()
    await expect(page.getByRole('button', { name: /At Risk/i }).last()).toBeVisible()
    await expect(page.getByRole('button', { name: /Active/i }).last()).toBeVisible()
    await expect(page.getByRole('button', { name: /Retained/i }).last()).toBeVisible()
  })

  test('filters to At Risk members', async ({ page }) => {
    await page.goto('/dashboard/members')

    // Click At Risk tab (last = visible desktop element)
    await page.getByRole('button', { name: /At Risk/i }).last().click()

    // Should show only high risk members with active tasks
    await expect(page.getByText('Derek Walsh').last()).toBeVisible()
    await expect(page.getByText('Priya Patel').last()).toBeVisible()
  })

  test('filters to Retained members', async ({ page }) => {
    await page.goto('/dashboard/members')

    await page.getByRole('button', { name: /Retained/i }).last().click()

    // Only Alex should be visible (outcome=engaged)
    await expect(page.getByText('Alex Martinez').last()).toBeVisible()
  })

  test('has back link to dashboard', async ({ page }) => {
    // Additional mocks for when we navigate to the dashboard page
    await page.route(api('/api/retention/scorecard'), route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasksCreated: 0, messagesSent: 0, membersRetained: 0, revenueRetained: 0, membersChurned: 0, conversationsActive: 0, escalations: 0 }) })
    })
    await page.route(api('/api/retention/activity'), route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/dashboard/members')

    const backLink = page.getByRole('link', { name: /Dashboard/i })
    await backLink.click()

    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
