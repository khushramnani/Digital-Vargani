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
