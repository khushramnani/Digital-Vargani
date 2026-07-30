import { test, expect } from '@playwright/test'

// SPEC.md's critical flow: "void -> cash-in-hand updates". Same
// auth-mocking pattern as the other e2e specs (no live Supabase project
// yet) — donations/expenses/handovers are backed by an in-memory array this
// test mutates on PATCH, so GETs made after the void reflect the real
// change, not a fixed fixture.
const SUPABASE_URL = 'http://127.0.0.1:54321'
const STORAGE_KEY = 'sb-127-auth-token'
const VOLUNTEER_ID = 'user-volunteer-void-1'

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

test('voiding a cash donation immediately drops that volunteer\'s cash-in-hand by the exact amount', async ({
  page,
}) => {
  const authUserId = 'fake-volunteer-auth-id-void'
  const donation = {
    id: 'donation-void-1',
    receipt_no: 99,
    public_token: 'void-test-token',
    donor_name: 'Void Test Donor',
    donor_phone: '9000000001',
    amount_paise: 50000, // ₹500
    mode: 'cash',
    collected_by: VOLUNTEER_ID,
    created_at: new Date().toISOString(),
    voided: false,
    void_reason: null,
    voided_by: null,
    voided_at: null,
    sms_sent_at: new Date().toISOString(),
    client_idempotency_key: null,
  }

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
        id: VOLUNTEER_ID,
        name: 'Void Test Volunteer',
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
  await page.route(`${SUPABASE_URL}/rest/v1/expenses*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/handovers*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/donations*`, (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([donation]) })
    }
    return route.continue()
  })

  // Voiding stopped being a direct PATCH on /donations when it moved to the
  // void_row RPC — the RPC stamps voided_by/voided_at from the session so a
  // client cannot forge them, and the append-only trigger makes it one-way.
  // The old PATCH stub above therefore never fired, and the row never
  // changed, which is why the "Removed —" line never appeared and
  // cash-in-hand never dropped. Mirror the RPC's effect on the fixture.
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/void_row*`, (route) => {
    const { reason } = route.request().postDataJSON() as { reason: string }
    Object.assign(donation, { voided: true, void_reason: reason })
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })

  await page.goto('/volunteer/cash-in-hand')
  await expect(page.getByRole('heading', { name: 'Cash in Hand' })).toBeVisible()
  await expect(page.getByText('₹500')).toBeVisible()

  await page.goto('/collect/history')
  await expect(page.getByText('Void Test Donor')).toBeVisible()

  // Two things drifted out from under this spec. The collection row became
  // a disclosure button that has to be expanded before its actions exist —
  // and its accessible name starts with "Void", so the old locator matched
  // the ROW, silently expanding it instead of voiding. Hence exact: true
  // everywhere below.
  await page.getByRole('button', { name: /^Void Test Donor/ }).click()

  // And voiding itself moved from window.prompt to a real focus-trapped
  // ConfirmDialog (the prompt froze the page and looked unbranded), so the
  // native `dialog` event this spec waited on no longer fires at all.
  // The volunteer-facing action is "Delete" now, and the row it marks reads
  // "Removed — <reason>". The underlying operation is unchanged: still a
  // reversible void that leaves the row in the books, which is why the
  // cash-in-hand assertion below is the real subject of this test.
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const voidDialog = page.getByRole('dialog')
  await voidDialog.getByLabel('Reason (optional)').fill('Wrong amount entered')
  await voidDialog.getByRole('button', { name: 'Delete donation', exact: true }).click()
  // Removed rows moved out of the main list into a collapsed section, so
  // they stop competing with live collections for the volunteer's attention.
  await page.getByRole('button', { name: /^Show removed/ }).click()
  await expect(page.getByText(/Removed — Wrong amount entered/)).toBeVisible()

  await page.goto('/volunteer/cash-in-hand')
  await expect(page.getByText('₹0')).toBeVisible()
})
