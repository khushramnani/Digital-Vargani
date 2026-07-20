import { test, expect } from '@playwright/test'

const SUPABASE_URL = 'http://127.0.0.1:54321' // matches .env.local's VITE_SUPABASE_URL

test('an unknown or expired invite link fails cleanly, not a silent redirect to /login', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/invite_preview*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await page.goto('/join/some-bogus-token')

  await expect(page.getByRole('alert')).toHaveText(/invalid or has expired/i)
  await expect(page).not.toHaveURL(/\/login$/)
})

test('a live invite names the mandal and role before any sign-in', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/invite_preview*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ mandal_name: 'Vinayak Mitra Mandal', role: 'volunteer', invitee_name: 'Sita Volunteer' }]),
    }),
  )

  await page.goto('/join/live-token')

  await expect(page.getByText('Vinayak Mitra Mandal')).toBeVisible()
  await expect(page.getByText(/invites you as/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
})
