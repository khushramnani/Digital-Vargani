import { test, expect } from '@playwright/test'

// Task 7/8's critical flow SPEC.md names: "log donation -> SMS deep link
// fires". Same auth-mocking pattern as volunteer-invite.spec.ts /
// offline-queue.spec.ts (no live Supabase project yet).
//
// What this can and can't verify in headless Chromium: a spike confirmed
// window.location.href = 'sms:...' (send.ts's buildSmsLink target) is not
// observable via page.route or a Location property override — Chromium
// resolves it as an unknown protocol and silently no-ops, with no request
// ever reaching the network layer and no property setter ever firing. So
// this test verifies the flow's real, observable side effects instead:
// the donation is created and shows its receipt number, the always-present
// "Send Receipt" fallback (Task 8's explicit-tap affordance) is there, and
// markSmsSent's PATCH — the one part of sendReceiptSms that *does* hit the
// network — fires automatically right after a successful submit. buildSmsLink
// itself (the sms:/iOS-vs-Android separator logic) is covered by its own
// unit test (send.test.ts).
const SUPABASE_URL = 'http://127.0.0.1:54321'
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

test('submitting a donation shows the receipt number, the Send via SMS fallback, and auto-fires markSmsSent', async ({
  page,
}) => {
  const authUserId = 'fake-volunteer-auth-id-sms'
  const patchBodies: unknown[] = []

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
        id: 'user-volunteer-sms-1',
        name: 'SMS Test Volunteer',
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

  await page.route(`${SUPABASE_URL}/rest/v1/donations*`, (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'donation-sms-1',
          receipt_no: 42,
          public_token: 'sms-test-token',
          donor_name: 'SMS Donor',
          donor_phone: '9876543210',
          amount_paise: 25000,
          mode: 'cash',
          collected_by: 'user-volunteer-sms-1',
          created_at: new Date().toISOString(),
          voided: false,
          void_reason: null,
          voided_by: null,
          voided_at: null,
          sms_sent_at: null,
          client_idempotency_key: 'whatever',
        }),
      })
    }
    if (method === 'PATCH') {
      patchBodies.push(route.request().postDataJSON())
      return route.fulfill({ status: 204, body: '' })
    }
    return route.continue()
  })

  await page.goto('/collect')
  await expect(page.getByRole('heading', { name: 'Collect Donation' })).toBeVisible()

  await page.getByLabel('Donor Name').fill('SMS Donor')
  await page.getByLabel('Phone').fill('9876543210')
  await page.getByLabel('Amount (₹)').fill('250')
  await page.getByRole('button', { name: 'Cash' }).click()
  await page.getByRole('button', { name: 'Record Donation' }).click()

  await expect(page.getByText('Receipt #42')).toBeVisible()
  const sendButton = page.getByRole('button', { name: 'Send via SMS' })
  await expect(sendButton).toBeVisible()
  await expect(sendButton).toBeEnabled()

  // The auto-send attempt (CollectionForm calls sendReceiptSms right after
  // a successful sync, no click needed) already fired markSmsSent by now.
  await expect.poll(() => patchBodies.length).toBeGreaterThan(0)
  expect(patchBodies[0]).toMatchObject({ sms_sent_at: expect.any(String) })

  // The explicit-tap fallback must also work without crashing the app.
  await sendButton.click()
  await expect(page.getByRole('heading', { name: 'Collect Donation' })).toBeVisible()
})
