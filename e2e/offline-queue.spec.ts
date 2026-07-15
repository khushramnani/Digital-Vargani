import { test, expect } from '@playwright/test'

// Task 10: the first task where a REAL offline test is possible —
// page.context().setOffline(true) genuinely disconnects the browser's
// network stack, so this exercises real IndexedDB (via Dexie) with no
// mocking of the offline behavior itself. Same auth-mocking pattern as
// e2e/volunteer-invite.spec.ts (a real Supabase magic-link/session round
// trip needs a live project, which doesn't exist yet — that part is
// mocked; the offline queue/sync logic under test is not).
const SUPABASE_URL = 'http://127.0.0.1:54321' // matches .env.local's VITE_SUPABASE_URL
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

test('offline: a submitted donation lands in the local queue, shows "Waiting for signal" in Pending sends, and survives a full page reload', async ({
  page,
  context,
}) => {
  const authUserId = 'fake-volunteer-auth-id-offline'

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
        id: 'user-volunteer-offline-1',
        name: 'Offline Test Volunteer',
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

  // Load the app and establish the session while still online — real
  // offline emulation (below) blocks every network request the browser
  // makes, including the dev server's own asset requests, so the initial
  // load has to happen before going offline.
  await page.goto('/volunteer')
  await expect(page.getByRole('heading', { name: 'Collect Donation' })).toBeVisible()

  // Real offline emulation, not a mock. This is the point of the test:
  // exercise the actual browser IndexedDB/Dexie write path against a
  // genuinely disconnected network, not a stubbed response.
  await context.setOffline(true)

  await page.getByLabel('Donor Name').fill('Offline Donor')
  await page.getByLabel('Phone').fill('9876543210')
  await page.getByLabel('Amount (₹)').fill('250')
  await page.getByRole('button', { name: 'Cash' }).click()
  await page.getByRole('button', { name: 'Record Donation' }).click()

  // Saved-offline confirmation, not an error — no receipt number, since
  // there's no public_token until the row actually syncs.
  await expect(page.getByText("Saved — will send once you're back online.")).toBeVisible()
  await expect(page.getByText(/Receipt #/)).toHaveCount(0)

  await page.getByRole('link', { name: 'Pending sends' }).click()
  await expect(page.getByText('Offline Donor')).toBeVisible()
  await expect(page.getByText('Waiting for signal')).toBeVisible()

  // No live Supabase project exists (same constraint as every prior task) —
  // there is nothing actually listening on SUPABASE_URL either way, so
  // going back "online" here only unblocks the Vite dev server's own asset
  // requests for the reload below (there's no service-worker asset cache
  // in `npm run dev` mode to serve the page instead). It does not hand the
  // app a real backend to sync against: any sync attempt the app makes
  // after reload still fails (connection refused), so nothing can
  // silently sync/delete the queued row between here and the assertion
  // below — what survives the reload is genuine IndexedDB persistence,
  // not an artifact of a live sync completing.
  await context.setOffline(false)
  await page.reload()

  await expect(page.getByText('Offline Donor')).toBeVisible()
  await expect(page.getByText('Waiting for signal')).toBeVisible()
})
