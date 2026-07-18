import { test, expect } from '@playwright/test'

// A real magic-link round trip (send email -> click link -> session
// established) can't be tested without a live Supabase project + email
// delivery. What's real and meaningful without a backend: an unauthenticated
// browser has no Supabase session token, period, so visiting the protected
// /admin route must redirect to /login. Manual verification of the actual
// email-link flow is still needed once a real Supabase project exists.
test('visiting /admin with no session redirects to /login', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login$/)
})

function fakeStoredSession(userId: string) {
  return {
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

test('an admin session can also reach the volunteer collection form to log a donation as themselves', async ({
  page,
}) => {
  const SUPABASE_URL = 'http://127.0.0.1:54321'
  const STORAGE_KEY = 'sb-127-auth-token'
  const authUserId = 'fake-admin-auth-id'

  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: fakeStoredSession(authUserId) },
  )
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/users*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-admin-1',
        name: 'Test Admin',
        phone: null,
        email: 'admin@example.com',
        role: 'admin',
        invite_token: null,
        auth_user_id: authUserId,
        active: true,
        created_at: new Date().toISOString(),
      }),
    }),
  )

  await page.goto('/collect')
  await expect(page.getByRole('heading', { name: 'Collect Donation' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/login$/)
})
