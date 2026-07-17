import { test, expect } from '@playwright/test'

const SUPABASE_URL = 'http://127.0.0.1:54321' // matches playwright.config.ts's webServer env
const STORAGE_KEY = 'sb-127-auth-token'
const AUTH_USER_ID = 'fake-founder-auth-id'
const MANDAL_ID = '33333333-3333-3333-3333-000000000003'

// Same shape as e2e/admin-auth.spec.ts's helper — a founder's session is an
// ordinary email session; what makes them a founder is having no users row.
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

// The self-serve path the landing page advertises but could not deliver
// before multi-tenancy: land -> signup -> become admin of a brand-new
// mandal -> reach the dashboard.
test('a new founder can create a mandal and reach the admin dashboard', async ({ page }) => {
  // The whole point of the test. Before create_mandal the founder has no
  // users row, which is what routes them to /signup; after, they have the
  // row create_mandal inserted, which is what lets RequireRole admit them to
  // /admin. If the users lookup answered the same both times this would be a
  // login test: Signup.tsx bounces an existing member straight to /admin, so
  // the form would never render and nothing would be proven.
  let mandalCreated = false

  await page.addInitScript(({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)), {
    key: STORAGE_KEY,
    session: fakeStoredSession(AUTH_USER_ID),
  })

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )

  // Two different callers hit /rest/v1/users and want different shapes, so
  // one glob cannot serve both: AuthProvider.fetchAppUser filters by
  // auth_user_id and uses maybeSingle() (one object, or null), while the
  // master ledger selects id/role for every member and maps over an array.
  await page.route(`${SUPABASE_URL}/rest/v1/users*`, (route) => {
    const isAuthLookup = route.request().url().includes('auth_user_id=eq.')
    if (!isAuthLookup) {
      // The ledger's member list. Empty is fine — this test asserts the URL
      // reached, not the dashboard's arithmetic.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: mandalCreated
        ? JSON.stringify({
            id: 'user-founder-1',
            mandal_id: MANDAL_ID,
            name: 'E2E Founder',
            phone: null,
            email: 'founder@example.com',
            role: 'admin',
            invite_token: null,
            auth_user_id: AUTH_USER_ID,
            active: true,
            created_at: new Date().toISOString(),
          })
        : 'null',
    })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_mandal*`, (route) => {
    mandalCreated = true
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANDAL_ID) })
  })

  // /admin renders the master ledger, which fetches the mandal (for the bank
  // opening balance) plus the three money tables. Stubbed so the dashboard
  // renders instead of erroring; the assertion under test is the URL.
  await page.route(`${SUPABASE_URL}/rest/v1/mandals*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: MANDAL_ID, name: 'E2E Test Mandal', slug: 'e2e-test-mandal', bank_opening_paise: 0 }),
    }),
  )
  for (const table of ['donations', 'expenses', 'handovers']) {
    await page.route(`${SUPABASE_URL}/rest/v1/${table}*`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
  }

  await page.goto('/')

  // 'Start your mandal free' is on the page twice: the hero's copy of it is
  // an <a href="#cta"> that only scrolls, and this one — inside the #cta
  // section — is the <Link to="/signup"> that actually starts signup. Same
  // accessible name, so scope to the section rather than picking by index.
  await page.locator('#cta').getByRole('link', { name: 'Start your mandal free' }).click()
  await expect(page).toHaveURL(/\/signup$/)

  await page.getByLabel('Mandal name').fill('E2E Test Mandal')
  await page.getByLabel('Your name').fill('E2E Founder')
  // Optional, and deliberately exercised: a blank slug field must reach the
  // RPC as undefined so the server derives the slug from the mandal name.
  await page.getByLabel('Public link (optional)').fill('e2e-test-mandal')

  const createMandalCall = page.waitForRequest(`${SUPABASE_URL}/rest/v1/rpc/create_mandal*`)
  await page.getByRole('button', { name: 'Create mandal' }).click()

  // create_mandal takes all three fields; asserting the payload here is what
  // stops the slug field from silently going nowhere.
  const request = await createMandalCall
  expect(request.postDataJSON()).toEqual({
    mandal_name: 'E2E Test Mandal',
    admin_name: 'E2E Founder',
    slug_hint: 'e2e-test-mandal',
  })

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible()
})
