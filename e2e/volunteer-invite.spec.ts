import { test, expect } from '@playwright/test'

// No live Supabase project exists yet. Both tests here mock the Supabase
// REST/Auth endpoints at the network layer (page.route) rather than the
// Vitest-style module mock — this exercises the real AuthProvider/RequireRole/
// InviteRedeem code running in a real browser, just with a stand-in backend.
const SUPABASE_URL = 'http://127.0.0.1:54321' // matches .env.local's VITE_SUPABASE_URL
// supabase-js's default storage key is `sb-${new URL(url).hostname.split('.')[0]}-auth-token`.
const STORAGE_KEY = 'sb-127-auth-token'

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

test('a volunteer session hitting /admin is redirected away, not granted access', async ({ page }) => {
  const authUserId = 'fake-volunteer-auth-id'

  // Seed a persisted session before any app JS runs, so AuthProvider resolves
  // session -> non-null on mount without a live Supabase Auth server.
  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: fakeStoredSession(authUserId) },
  )

  // link_admin_account is a documented no-op for non-admins; any response is fine.
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )
  // The `users` row AuthProvider resolves appUser from: a volunteer, not an admin.
  await page.route(`${SUPABASE_URL}/rest/v1/users*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-volunteer-1',
        name: 'Test Volunteer',
        phone: null,
        email: null,
        role: 'volunteer',
        invite_token: null,
        auth_user_id: authUserId,
        active: true,
        created_at: new Date().toISOString(),
      }),
    }),
  )

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login$/)
})

test('an invite link fails cleanly (not a silent redirect to /login) when anonymous sign-in fails', async ({
  page,
}) => {
  // Simulates the Anonymous Sign-ins project setting being off, or any
  // sign-in failure — this is the "invalid invite" experience without a
  // backend at all.
  await page.route(`${SUPABASE_URL}/auth/v1/signup*`, (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error_code: 'anonymous_provider_disabled',
        msg: 'Anonymous sign-ins are disabled',
      }),
    }),
  )

  await page.goto('/invite/some-bogus-token')

  await expect(page.getByRole('alert')).toHaveText(/invalid or has already been used/i)
  await expect(page).not.toHaveURL(/\/login$/)
})
