import { test, expect } from '@playwright/test'

// SPEC.md's critical flow: "handover -> cash-in-hand zeroes" (drops by the
// handed amount, here from a nonzero balance rather than exactly to zero,
// which is the more general form of the same assertion). Same
// auth-mocking pattern as the other e2e specs — donations is a fixed
// in-memory donation, handovers is an in-memory array this test appends to
// on POST, so the cash-in-hand read after submitting the handover reflects
// the real new row, not a fixed fixture.
const SUPABASE_URL = 'http://127.0.0.1:54321'
const STORAGE_KEY = 'sb-127-auth-token'
const VOLUNTEER_ID = 'user-volunteer-handover-1'
const ADMIN_ID = 'user-admin-handover-1'

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

test('recording a handover immediately drops that volunteer\'s cash-in-hand by the handed amount', async ({
  page,
}) => {
  const authUserId = 'fake-volunteer-auth-id-handover'
  const donation = {
    id: 'donation-handover-1',
    receipt_no: 5,
    public_token: 'handover-test-token',
    donor_name: 'Handover Test Donor',
    donor_phone: '9000000002',
    amount_paise: 80000, // ₹800
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
  const handovers: Record<string, unknown>[] = []

  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: fakeStoredSession(authUserId) },
  )
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/list_admins*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: ADMIN_ID, name: 'Admin Treasurer' }]),
    }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/users*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: VOLUNTEER_ID,
        name: 'Handover Test Volunteer',
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
  await page.route(`${SUPABASE_URL}/rest/v1/donations*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([donation]) }),
  )
  await page.route(`${SUPABASE_URL}/rest/v1/handovers*`, (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(handovers) })
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      const created = {
        id: `handover-${handovers.length + 1}`,
        ...body,
        created_at: new Date().toISOString(),
        voided: false,
        void_reason: null,
        voided_by: null,
        voided_at: null,
        // getHandovers() re-fetches with these embeds (see
        // lib/db/handovers.ts) — the mock has to shape them the same way a
        // real PostgREST embed would.
        volunteer: { name: 'Handover Test Volunteer' },
        received_by_user: { name: 'Admin Treasurer' },
      }
      handovers.push(created)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) })
    }
    return route.continue()
  })

  await page.goto('/volunteer/cash-in-hand')
  await expect(page.getByRole('heading', { name: 'Cash in Hand' })).toBeVisible()
  await expect(page.getByText('₹800')).toBeVisible()

  await page.goto('/volunteer/handover')
  await page.getByLabel('Amount (₹)').fill('300')
  await page.getByLabel('Received by').selectOption(ADMIN_ID)
  await page.getByRole('button', { name: 'Log Handover' }).click()
  await expect(page.getByText('To Admin Treasurer')).toBeVisible()

  await page.goto('/volunteer/cash-in-hand')
  await expect(page.getByText('₹500')).toBeVisible()
})
