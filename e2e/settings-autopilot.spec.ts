/**
 * Settings Autopilot E2E Tests
 *
 * Tests the autopilot toggle in the Settings panel:
 * - Toggle renders
 * - Clicking toggle sends API request
 * - Shadow mode message appears
 *
 * Run: npm run test:e2e:headed
 * Requires: npm run dev running on localhost:3000
 */
import { test, expect } from '@playwright/test'

// Helper: match API routes by pathname (won't catch Next.js chunk/asset requests)
const api = (path: string) => (url: URL) => url.pathname === path || url.pathname.startsWith(path + '?')

const MOCK_DASHBOARD = {
  user: { email: 'test@gym.com' },
  gym: { id: 'gym-1', gym_name: 'Test Gym', member_count: 120, autopilot_enabled: false, avg_membership_value: 150 },
  tier: 'pro',
  pendingActions: [],
  agents: [],
  recentRuns: [],
  monthlyRunCount: 5,
}

test.describe('Autopilot Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(api('/api/dashboard'), route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DASHBOARD),
      })
    })

    await page.route(api('/api/retention/scorecard'), route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasksCreated: 0, messagesSent: 0, membersRetained: 0, revenueRetained: 0, membersChurned: 0, conversationsActive: 0, escalations: 0 }) })
    })

    await page.route(api('/api/retention/activity'), route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  })

  test('shows autopilot toggle in settings', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for dashboard to fully render
    await expect(page.getByText('MEMBERS RETAINED')).toBeVisible({ timeout: 10000 })

    // Click Settings button in the desktop sidebar nav
    await page.getByTestId('desktop-nav').getByRole('button', { name: 'Settings' }).click()

    // Should see the autopilot section
    await expect(page.getByText('Autopilot Mode').last()).toBeVisible()
    await expect(page.getByText('Auto-send agent messages').last()).toBeVisible()
  })

  test('toggling autopilot sends API request and shows shadow mode', async ({ page }) => {
    let autopilotToggled = false
    const shadowEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await page.route(api('/api/settings/autopilot'), route => {
      if (route.request().method() === 'POST') {
        autopilotToggled = true
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, autopilot_enabled: true, shadow_mode_ends: shadowEnd }),
        })
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ autopilotEnabled: false, shadowModeUntil: null }),
        })
      }
    })

    await page.goto('/dashboard')

    // Wait for dashboard to fully render
    await expect(page.getByText('MEMBERS RETAINED')).toBeVisible({ timeout: 10000 })

    // Click Settings in the desktop sidebar
    await page.getByTestId('desktop-nav').getByRole('button', { name: 'Settings' }).click()

    await expect(page.getByText('Autopilot Mode').last()).toBeVisible()

    // Click the autopilot toggle switch
    const toggleButton = page.locator('button').filter({ has: page.locator('span.inline-block.bg-white') }).last()
    await toggleButton.click()

    expect(autopilotToggled).toBe(true)

    // Shadow mode message should appear
    await expect(page.getByText(/Shadow mode active/)).toBeVisible()
  })
})
