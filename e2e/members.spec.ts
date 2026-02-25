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

    await expect(page.getByText('Derek Walsh')).toBeVisible()
    await expect(page.getByText('Priya Patel')).toBeVisible()
    await expect(page.getByText('Alex Martinez')).toBeVisible()
    await expect(page.getByText('Mike Torres')).toBeVisible()
  })

  test('shows filter tabs', async ({ page }) => {
    await page.goto('/dashboard/members')

    await expect(page.getByRole('button', { name: /All/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /At Risk/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Active/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Retained/i })).toBeVisible()
  })

  test('filters to At Risk members', async ({ page }) => {
    await page.goto('/dashboard/members')

    // Click At Risk tab
    await page.getByRole('button', { name: /At Risk/i }).click()

    // Should show only high risk members with active tasks
    await expect(page.getByText('Derek Walsh')).toBeVisible()
    await expect(page.getByText('Priya Patel')).toBeVisible()
  })

  test('filters to Retained members', async ({ page }) => {
    await page.goto('/dashboard/members')

    await page.getByRole('button', { name: /Retained/i }).click()

    // Only Alex should be visible (outcome=engaged)
    await expect(page.getByText('Alex Martinez')).toBeVisible()
  })

  test('has back link to dashboard', async ({ page }) => {
    // Mock dashboard API for navigation
    await page.route(api('/api/dashboard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { email: 'test@gym.com' }, gym: null, pendingActions: [], agents: [], recentRuns: [], tier: 'free' }),
      })
    })
    await page.route(api('/api/retention/scorecard'), route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
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
