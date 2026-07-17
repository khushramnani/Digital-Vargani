# Admin Management, Admin-as-Volunteer, WhatsApp Send, VYM Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create other admins (mirroring the volunteer-invite pattern), let an admin also use the volunteer collection flow, add a WhatsApp send option alongside the existing SMS deep link, and rename the product to "Vinayak Yuvak Mandal (VYM)" in user-facing/formal spots.

**Architecture:** Every change reuses existing schema and RLS (`is_admin()`-gated policies already permit everything needed — no migration in this plan). `RequireRole` widens from a single required role to a list; a new `AdminsScreen` mirrors the existing `VolunteersScreen` minus the token/copy-link mechanics; `send.ts` gains a WhatsApp sibling to its existing SMS link builder, reusing the same `sms_sent_at`-based "pending send" bookkeeping for both channels.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, Supabase JS client, Vitest + React Testing Library, Playwright.

## Global Constraints

- TypeScript strict; run `npm run typecheck` before every commit.
- All user-facing copy goes through `src/lib/strings.ts` — no inline text in JSX.
- Money is never touched here; no task in this plan changes `money.ts`/`reconcile.ts`.
- `collected_by`/`paid_by`/etc. is always the session's `appUser.id`, never form-supplied — no task in this plan changes that invariant.
- No new dependency: the WhatsApp link is a plain `https://wa.me/` URL, no SDK.
- No RLS/migration changes in this plan — every new query/insert is covered by existing policies in `supabase/migrations/20260714111950_schema_and_rls.sql` and `20260714121305_add_users_email.sql`.
- Run `npm run test -- --run` (full suite) and `npm run typecheck` after every task, before committing.

---

### Task 1: Rename to "Vinayak Yuvak Mandal (VYM)"

**Files:**
- Modify: `src/lib/strings.ts:3`
- Modify: `vite.config.ts:17-18`
- Modify: `index.html:8`
- Modify: `SPEC.md:1`

**Interfaces:**
- Consumes: nothing new.
- Produces: `strings.appName` remains the same export, new string value only.

- [ ] **Step 1: Update `strings.ts`**

In `src/lib/strings.ts`, change line 3:

```ts
  appName: 'Vinayak Mandal',
```
to:
```ts
  appName: 'Vinayak Yuvak Mandal (VYM)',
```

- [ ] **Step 2: Update `vite.config.ts` PWA manifest**

In `vite.config.ts`, change lines 17-18:

```ts
        name: 'Vinayak Mandal',
        short_name: 'Vinayak Mandal',
```
to:
```ts
        name: 'Vinayak Yuvak Mandal',
        short_name: 'VYM',
```

- [ ] **Step 3: Update `index.html` title**

In `index.html`, change line 8:

```html
    <title>Vinayak Mandal — Digital Vargani & Fund Management System</title>
```
to:
```html
    <title>Vinayak Yuvak Mandal (VYM) — Digital Vargani & Fund Management System</title>
```

- [ ] **Step 4: Update `SPEC.md` header**

In `SPEC.md`, change line 1:

```md
# Spec: Vinayak Mandal — Digital Vargani & Fund Management System
```
to:
```md
# Spec: Vinayak Yuvak Mandal (VYM) — Digital Vargani & Fund Management System
```

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm run typecheck && npm run test -- --run`
Expected: all pass. `tests/App.test.tsx` asserts against `strings.appName` dynamically (`screen.getByRole('heading', { name: strings.appName })`), so it passes unchanged with the new value.

- [ ] **Step 6: Commit**

```bash
git add src/lib/strings.ts vite.config.ts index.html SPEC.md
git commit -m "Rename app to Vinayak Yuvak Mandal (VYM)"
```

---

### Task 2: Widen RequireRole to accept multiple allowed roles

**Files:**
- Modify: `src/features/auth/RequireRole.tsx`
- Modify: `tests/RequireRole.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`appUser`, `session`, `loading`) — unchanged.
- Produces: `RequireRole`'s `role` prop now accepts `Role | Role[]` (was `Role`). Existing callers passing a single `Role` string keep working unchanged (no call site needs to change in this task — Task 3 changes three of them to arrays).

- [ ] **Step 1: Write the failing test**

Add to `tests/RequireRole.test.tsx`, inside the existing `describe('RequireRole', ...)` block (after the last `it`, before the closing `})`):

```tsx
  it('renders its children for an admin when the route allows either admin or volunteer', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: adminUser, error: null })

    renderGuardedRoute(['admin', 'volunteer'])

    await waitFor(() => expect(screen.getByText('Guarded Content')).toBeInTheDocument())
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('renders its children for a volunteer when the route allows either admin or volunteer', async () => {
    getSession.mockResolvedValue({ data: { session: fakeSession }, error: null })
    maybeSingle.mockResolvedValue({ data: volunteerUser, error: null })

    renderGuardedRoute(['admin', 'volunteer'])

    await waitFor(() => expect(screen.getByText('Guarded Content')).toBeInTheDocument())
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })
```

Also update the `renderGuardedRoute` helper's signature just above (currently `function renderGuardedRoute(requiredRole: 'admin' | 'volunteer')`) to accept an array too:

```tsx
function renderGuardedRoute(requiredRole: 'admin' | 'volunteer' | ('admin' | 'volunteer')[]) {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/RequireRole.test.tsx`
Expected: FAIL — `renderGuardedRoute(['admin', 'volunteer'])` passes an array where `RequireRole`'s `role` prop currently only accepts a single `Role`, and the `!== role` check would treat the array as never-equal, redirecting to `/login` instead of rendering "Guarded Content". (TypeScript will also flag the prop type mismatch — that's expected until Step 3.)

- [ ] **Step 3: Widen RequireRole**

Replace the full contents of `src/features/auth/RequireRole.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

// users.role is a plain `text` column with a CHECK constraint (not a
// Postgres enum — see database.types.ts), so this union is asserted here
// for call-site DX rather than derived from the generated Row type.
type Role = 'admin' | 'volunteer'

// Generalized from Task 4's ProtectedAdminRoute: any route can require any
// single role, or any one of several roles (e.g. a volunteer-flow route an
// admin should also be able to use), by passing either a single Role or a
// Role[].
export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { loading, session, appUser } = useAuth()
  const allowedRoles = Array.isArray(role) ? role : [role]

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</div>
    )
  }

  if (!session || !appUser || !allowedRoles.includes(appUser.role as Role)) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/RequireRole.test.tsx`
Expected: PASS — all 6 tests (4 existing + 2 new).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. Every existing call site (`<RequireRole role="admin">`, `<RequireRole role="volunteer">`) still type-checks since `Role` is a valid `Role | Role[]`.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/RequireRole.tsx tests/RequireRole.test.tsx
git commit -m "Widen RequireRole to accept a list of allowed roles"
```

---

### Task 3: Let admin reach the collection flow; add dashboard nav link

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/features/ledger/MasterLedger.tsx`
- Modify: `src/lib/strings.ts`
- Modify: `e2e/admin-auth.spec.ts`

**Interfaces:**
- Consumes: `RequireRole` with `role: Role | Role[]` (Task 2).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update the three volunteer-collection routes in `router.tsx`**

In `src/app/router.tsx`, change the `/volunteer`, `/volunteer/pending`, and `/volunteer/collections` routes' `role="volunteer"` to `role={['admin', 'volunteer']}`. The three blocks become:

```tsx
      <Route
        path="/volunteer"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <CollectionForm />
          </RequireRole>
        }
      />
```

```tsx
      <Route
        path="/volunteer/pending"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <PendingSend />
          </RequireRole>
        }
      />
```

```tsx
      <Route
        path="/volunteer/collections"
        element={
          <RequireRole role={['admin', 'volunteer']}>
            <CollectionsScreen />
          </RequireRole>
        }
      />
```

Leave every other route (`/volunteer/expenses`, `/volunteer/handover`, `/volunteer/cash-in-hand`, and all `/admin/*` routes) unchanged — those already have separate `/admin/*` equivalents where an admin needs the same data.

- [ ] **Step 2: Add a strings key for the new nav link**

In `src/lib/strings.ts`, inside the `admin` block, add a new key after `collectionsLink`:

```ts
    collectionsLink: 'All collections',
    collectDonationLink: 'Collect donation',
```

- [ ] **Step 3: Add the nav link to the admin dashboard**

In `src/features/ledger/MasterLedger.tsx`, add a new `Link` as the first item inside the `<div className="flex flex-col gap-2">` block (before the existing "All collections" link):

```tsx
      <div className="flex flex-col gap-2">
        <Link to="/volunteer" className="text-orange-700 underline">
          {strings.admin.collectDonationLink}
        </Link>
        <Link to="/admin/collections" className="text-orange-700 underline">
          {strings.admin.collectionsLink}
        </Link>
```

- [ ] **Step 4: Write the failing test for the new nav link**

Add to `tests/MasterLedger.test.tsx`, inside `describe('MasterLedgerScreen', ...)`:

```tsx
  it('links to the volunteer collection form so an admin can log a donation as themselves', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('link', { name: 'Collect donation' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Collect donation' })).toHaveAttribute('href', '/volunteer')
  })
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npx vitest run tests/MasterLedger.test.tsx`
Expected before Steps 2-3: FAIL (no "Collect donation" link exists yet). After Steps 2-3: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run typecheck && npm run test -- --run`
Expected: all pass.

- [ ] **Step 7: Add an e2e test proving an admin session can reach `/volunteer`**

`e2e/admin-auth.spec.ts` currently has no session-mocking helper (its one existing test just checks the no-session redirect). Add this after the existing `test('visiting /admin with no session redirects to /login', ...)` block — it defines its own `fakeStoredSession`, the same shape `volunteer-invite.spec.ts` and `donation-sms.spec.ts` each independently define, just with `role: 'admin'` in the mocked `users` row and asserting `/volunteer` is reachable instead of blocked:

```ts

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

  await page.goto('/volunteer')
  await expect(page.getByRole('heading', { name: 'Collect Donation' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/login$/)
})
```

- [ ] **Step 8: Run the e2e spec**

Run: `npx playwright test e2e/admin-auth.spec.ts`
Expected: PASS. (If this environment can't launch a browser, skip and note it in the commit message — Task 2's unit tests already prove the same `RequireRole(['admin', 'volunteer'])` logic in isolation.)

- [ ] **Step 9: Commit**

```bash
git add src/app/router.tsx src/features/ledger/MasterLedger.tsx src/lib/strings.ts tests/MasterLedger.test.tsx e2e/admin-auth.spec.ts
git commit -m "Let an admin reach the volunteer collection flow as themselves"
```

---

### Task 4: WhatsApp link builder in send.ts

**Files:**
- Modify: `src/features/collection/send.ts`
- Modify: `tests/send.test.ts`

**Interfaces:**
- Consumes: `Donation` type and `markSmsSent` from `src/lib/db/donations.ts` (already imported in `send.ts`); `toRupees` from `src/lib/money.ts`; `strings.collection.smsMessage` (already used by `sendReceiptSms`).
- Produces: `buildWhatsAppLink(phone: string, message: string): string` and `sendReceiptWhatsApp(donation: Donation): void`, for Tasks 5-6 to call.

- [ ] **Step 1: Write the failing tests**

Add to `tests/send.test.ts`, after the existing `describe('buildSmsLink', ...)` block:

```ts
describe('buildWhatsAppLink', () => {
  it('prepends 91 to a bare 10-digit number', () => {
    const link = buildWhatsAppLink('9876543210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('strips spaces/dashes/parens before checking the digit count', () => {
    const link = buildWhatsAppLink('(987) 654-3210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('leaves an already-prefixed international number unmodified (no re-prepending 91)', () => {
    const link = buildWhatsAppLink('+919876543210', 'Hello')
    expect(link).toBe('https://wa.me/919876543210?text=Hello')
  })

  it('leaves a non-10-digit number as-is rather than guessing a prefix', () => {
    const link = buildWhatsAppLink('12025550123', 'Hello')
    expect(link).toBe('https://wa.me/12025550123?text=Hello')
  })

  it('url-encodes the message the same way buildSmsLink does', () => {
    const link = buildWhatsAppLink('9876543210', 'Thank you & regards, receipt: https://x/r/tok')
    expect(link).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent('Thank you & regards, receipt: https://x/r/tok')}`,
    )
  })
})
```

Update the top import line of `tests/send.test.ts`:

```ts
import { buildSmsLink } from '../src/features/collection/send'
```
to:
```ts
import { buildSmsLink, buildWhatsAppLink } from '../src/features/collection/send'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/send.test.ts`
Expected: FAIL with "buildWhatsAppLink is not a function" (or a TypeScript import error).

- [ ] **Step 3: Implement buildWhatsAppLink and sendReceiptWhatsApp**

In `src/features/collection/send.ts`, add after the existing `buildSmsLink` function (after its closing `}` and before the `receiptUrl` function):

```ts
// WhatsApp's wa.me links need a full international number, digits only (no
// +, spaces, or symbols). Donor phone numbers are only validated as a
// plausible 7-15 digit count (lib/validation/donation.ts), not a specific
// format, so a bare 10-digit number is assumed to be an Indian mobile
// missing its country code and gets 91 prepended; anything else is passed
// through as-is on the assumption it already includes a country code.
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`
}
```

Add after the existing `sendReceiptSms` function (at the end of the file):

```ts

// Same shape as sendReceiptSms, opened in a new tab instead of same-tab
// navigation — unlike the sms: URI (an OS-handled protocol that never
// actually navigates the tab), https://wa.me/... is a normal URL, so
// window.location.href would leave the app. markSmsSent is reused
// unchanged: that column means "a receipt has been sent for this donation"
// for the Pending Send tray's purposes, not "sent via SMS specifically".
export function sendReceiptWhatsApp(donation: Donation): void {
  const message = strings.collection.smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token))
  window.open(buildWhatsAppLink(donation.donor_phone ?? '', message), '_blank')
  markSmsSent(donation.id).catch(() => {})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/send.test.ts`
Expected: PASS — all tests (existing `buildSmsLink` tests + new `buildWhatsAppLink` tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/collection/send.ts tests/send.test.ts
git commit -m "Add WhatsApp receipt-send link builder alongside SMS"
```

---

### Task 5: Two-button send choice in CollectionForm

**Files:**
- Modify: `src/features/collection/CollectionForm.tsx`
- Modify: `src/lib/strings.ts`
- Modify: `tests/CollectionForm.test.tsx`

**Interfaces:**
- Consumes: `sendReceiptSms`, `sendReceiptWhatsApp` from `src/features/collection/send.ts` (Task 4).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add new string keys, remove the old single-button key**

In `src/lib/strings.ts`, inside the `collection` block, replace:

```ts
    sendReceiptButton: 'Send Receipt',
```
with:
```ts
    sendReceiptSmsButton: 'Send via SMS',
    sendReceiptWhatsAppButton: 'Send via WhatsApp',
```

- [ ] **Step 2: Update the existing test that references the old button label**

In `tests/CollectionForm.test.tsx`, the test `'always renders a fallback "Send Receipt" button after submit, which re-fires the same SMS link when tapped'` currently does:

```tsx
    const sendButton = screen.getByRole('button', { name: 'Send Receipt' })
```

Change the test name and that line to:

```tsx
  it('always renders a fallback "Send via SMS" button after submit, which re-fires the same SMS link when tapped', async () => {
    renderForm()
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))

    window.location.href = 'https://vinayak-mandal.example/volunteer'
    markSmsSent.mockClear()

    const sendButton = screen.getByRole('button', { name: 'Send via SMS' })
    fireEvent.click(sendButton)

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(window.location.href).toBe(`sms:9876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })
```

- [ ] **Step 3: Write the new failing test for the WhatsApp button**

Add to `tests/CollectionForm.test.tsx`, after the test from Step 2 (before the `'links to the Pending Send tray'` test):

```tsx
  it('renders a "Send via WhatsApp" button after submit, which opens the wa.me link when tapped', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderForm()
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))
    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    markSmsSent.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/CollectionForm.test.tsx`
Expected: FAIL — the "Send via SMS" / "Send via WhatsApp" buttons don't exist yet (still "Send Receipt" only, no WhatsApp button).

- [ ] **Step 5: Update CollectionForm.tsx**

In `src/features/collection/CollectionForm.tsx`, add the import at the top (change the existing `sendReceiptSms` import line):

```tsx
import { sendReceiptSms } from './send'
```
to:
```tsx
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
```

Replace the `lastDonation &&` block:

```tsx
        {lastDonation && (
          <>
            <p className="text-sm text-green-700">
              {t.successPrefix}
              {lastDonation.receipt_no} — {t.nextDonation}
            </p>
            {/* Always rendered alongside the auto-redirect attempt above,
                not only when it fails — some browsers block the
                non-http navigation because it follows an `await`, and
                this is the volunteer's explicit-tap fallback for that
                case (Task 8 brief's ≤3-taps acceptance criterion). */}
            <button
              type="button"
              onClick={() => sendReceiptSms(lastDonation)}
              className="rounded border border-orange-700 px-3 py-3 text-orange-700"
            >
              {t.sendReceiptButton}
            </button>
          </>
        )}
```

with:

```tsx
        {lastDonation && (
          <>
            <p className="text-sm text-green-700">
              {t.successPrefix}
              {lastDonation.receipt_no} — {t.nextDonation}
            </p>
            {/* Always rendered alongside the auto-redirect attempt above,
                not only when it fails — some browsers block the
                non-http navigation because it follows an `await`, and
                this is the volunteer's explicit-tap fallback for that
                case (Task 8 brief's ≤3-taps acceptance criterion). Two
                channels, volunteer picks: SMS auto-fires above already,
                WhatsApp is opt-in only (opening a new tab isn't something
                to do without a tap). */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => sendReceiptSms(lastDonation)}
                className="flex-1 rounded border border-orange-700 px-3 py-3 text-orange-700"
              >
                {t.sendReceiptSmsButton}
              </button>
              <button
                type="button"
                onClick={() => sendReceiptWhatsApp(lastDonation)}
                className="flex-1 rounded border border-orange-700 px-3 py-3 text-orange-700"
              >
                {t.sendReceiptWhatsAppButton}
              </button>
            </div>
          </>
        )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/CollectionForm.test.tsx`
Expected: PASS — all tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm run typecheck && npm run test -- --run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/collection/CollectionForm.tsx src/lib/strings.ts tests/CollectionForm.test.tsx
git commit -m "Let a volunteer choose SMS or WhatsApp for the receipt send"
```

---

### Task 6: Two-button send choice in PendingSend

**Files:**
- Modify: `src/features/collection/PendingSend.tsx`
- Modify: `src/lib/strings.ts`
- Modify: `tests/PendingSend.test.tsx`

**Interfaces:**
- Consumes: `sendReceiptSms`, `sendReceiptWhatsApp` from `src/features/collection/send.ts` (Task 4).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update string keys**

In `src/lib/strings.ts`, inside the `pendingSend` block, replace:

```ts
    sendButton: 'Send',
    sent: 'Sent!',
```
with:
```ts
    sendSmsButton: 'SMS',
    sendWhatsAppButton: 'WhatsApp',
    sent: 'Sent!',
```

- [ ] **Step 2: Update existing tests that reference the old "Send" button**

In `tests/PendingSend.test.tsx`, update the test `'tapping Send fires the same SMS link flow and marks the donation sent'`:

```tsx
  it('tapping SMS fires the same SMS link flow and marks the donation sent', async () => {
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'SMS' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(window.location.href).toBe(`sms:9876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })
```

Update the test `'shows the volunteer's own still-queued ... no Send button'`'s final assertion:

```tsx
    // The server-fetched row still gets its Send button — only the queued
    // (not-yet-synced) row has none, since it has no public_token yet.
    expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(1)
```
to:
```tsx
    // The server-fetched row still gets its send buttons — only the queued
    // (not-yet-synced) row has none, since it has no public_token yet.
    expect(screen.getAllByRole('button', { name: 'SMS' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'WhatsApp' })).toHaveLength(1)
```

- [ ] **Step 3: Write the new failing test for the WhatsApp button**

Add to `tests/PendingSend.test.tsx`, right after the "tapping SMS..." test from Step 2:

```tsx
  it('tapping WhatsApp opens the wa.me link and marks the donation sent', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderPendingSend()
    await waitFor(() => expect(screen.getByText('Ramesh Kulkarni')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/tok-abc',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/PendingSend.test.tsx`
Expected: FAIL — no "SMS"/"WhatsApp" buttons exist yet (still one "Send" button).

- [ ] **Step 5: Update PendingSend.tsx**

In `src/features/collection/PendingSend.tsx`, change the import line:

```tsx
import { sendReceiptSms } from './send'
```
to:
```tsx
import { sendReceiptSms, sendReceiptWhatsApp } from './send'
```

Replace the `handleSend` function:

```tsx
  function handleSend(donation: Donation) {
    sendReceiptSms(donation)
    setSentIds((current) => new Set(current).add(donation.id))
  }
```

with two functions:

```tsx
  function handleSendSms(donation: Donation) {
    sendReceiptSms(donation)
    setSentIds((current) => new Set(current).add(donation.id))
  }

  function handleSendWhatsApp(donation: Donation) {
    sendReceiptWhatsApp(donation)
    setSentIds((current) => new Set(current).add(donation.id))
  }
```

Replace the per-row send button:

```tsx
              {donation.voided ? null : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSend(donation)}
                    className="rounded border border-orange-700 px-3 py-2 text-orange-700"
                  >
                    {sentIds.has(donation.id) ? t.sent : t.sendButton}
                  </button>
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(donation, reason)} />
                </div>
              )}
```

with:

```tsx
              {donation.voided ? null : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendSms(donation)}
                    className="rounded border border-orange-700 px-3 py-2 text-orange-700"
                  >
                    {sentIds.has(donation.id) ? t.sent : t.sendSmsButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendWhatsApp(donation)}
                    className="rounded border border-orange-700 px-3 py-2 text-orange-700"
                  >
                    {sentIds.has(donation.id) ? t.sent : t.sendWhatsAppButton}
                  </button>
                  <VoidButton label={t.voidButton} prompt={t.voidPrompt} onVoid={(reason) => handleVoid(donation, reason)} />
                </div>
              )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/PendingSend.test.tsx`
Expected: PASS — all tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm run typecheck && npm run test -- --run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/collection/PendingSend.tsx src/lib/strings.ts tests/PendingSend.test.tsx
git commit -m "Let a volunteer choose SMS or WhatsApp from the Pending Send tray"
```

---

### Task 7: Update the e2e SMS spec for the renamed button

**Files:**
- Modify: `e2e/donation-sms.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the button name references**

In `e2e/donation-sms.spec.ts`, update the test title and the two lines referencing the old button label:

```ts
test('submitting a donation shows the receipt number, the Send Receipt fallback, and auto-fires markSmsSent', async ({
```
to:
```ts
test('submitting a donation shows the receipt number, the Send via SMS fallback, and auto-fires markSmsSent', async ({
```

```ts
  const sendButton = page.getByRole('button', { name: 'Send Receipt' })
```
to:
```ts
  const sendButton = page.getByRole('button', { name: 'Send via SMS' })
```

- [ ] **Step 2: Run the e2e spec**

Run: `npx playwright test e2e/donation-sms.spec.ts`
Expected: PASS. (If this environment can't launch a browser, skip this step and rely on Task 5/6's unit-level coverage of the same button-click behavior — note that in the commit message if skipped.)

- [ ] **Step 3: Commit**

```bash
git add e2e/donation-sms.spec.ts
git commit -m "Update donation-sms e2e spec for the renamed Send via SMS button"
```

---

### Task 8: Admin management screen

**Files:**
- Create: `src/features/settings/admins.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/lib/strings.ts`
- Modify: `src/features/ledger/MasterLedger.tsx`

**Interfaces:**
- Consumes: `supabase` client (`src/lib/db/client.ts`), `Tables` type (`src/lib/db/database.types.ts`) — same imports `VolunteersScreen` already uses.
- Produces: `AdminsScreen` component, routed at `/admin/admins`. No other task depends on this one.

- [ ] **Step 1: Add strings for the new screen**

In `src/lib/strings.ts`, add a new top-level block after `volunteers` (before `collection`):

```ts
  admins: {
    title: 'Admins',
    nameLabel: 'Name',
    emailLabel: 'Email',
    addButton: 'Add admin',
    adding: 'Adding…',
    empty: 'No admins yet.',
    pending: 'Pending',
    active: 'Active',
    loginHint: "They'll get a login link by entering this email at /login.",
    errors: {
      email: 'Enter a valid email address.',
    },
  },
```

Also add a nav-link key to the `admin` block, after `collectDonationLink` (added in Task 3):

```ts
    collectDonationLink: 'Collect donation',
    adminsLink: 'Manage admins',
```

- [ ] **Step 2: Create the AdminsScreen component**

Create `src/features/settings/admins.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
import type { Tables } from '../../lib/db/database.types'

type Admin = Tables<'users'>

// Same data-fetching shape as volunteers.tsx's fetchVolunteers: a plain
// function (no setState inside) so both the initial-load effect and the
// post-submit refetch each own their own setState calls.
async function fetchAdmins(): Promise<Admin[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'admin')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Admin-only screen (routed behind RequireRole role="admin"). Deliberately
// simpler than volunteers.tsx: an admin's "invite" is just requesting a
// magic link at /login with the email added here (link_admin_account, see
// 20260714121305_add_users_email.sql, links it on first login) — no
// invite_token/copy-link UI needed, unlike a volunteer's token-based invite.
export function AdminsScreen() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchAdmins()
      .then((data) => {
        if (active) setAdmins(data)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setEmailError(null)

    if (!isValidEmail(email)) {
      setEmailError(strings.admins.errors.email)
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('users').insert({
      name,
      email,
      role: 'admin',
    })

    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setEmail('')
    setAdmins(await fetchAdmins())
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{strings.admins.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-stone-300 p-4">
        <label htmlFor="admin-name" className="text-sm text-stone-600">
          {strings.admins.nameLabel}
        </label>
        <input
          id="admin-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="admin-email" className="text-sm text-stone-600">
          {strings.admins.emailLabel}
        </label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        {emailError && (
          <p role="alert" className="text-sm text-red-700">
            {emailError}
          </p>
        )}
        <p className="text-sm text-stone-500">{strings.admins.loginHint}</p>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? strings.admins.adding : strings.admins.addButton}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : admins.length === 0 ? (
        <p className="text-stone-400">{strings.admins.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {admins.map((admin) => (
            <li key={admin.id} className="rounded border border-stone-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-stone-900">{admin.name}</span>
                <span className={admin.auth_user_id ? 'text-green-700' : 'text-amber-700'}>
                  {admin.auth_user_id ? strings.admins.active : strings.admins.pending}
                </span>
              </div>
              {admin.email && <p className="text-sm text-stone-600">{admin.email}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Add the route**

In `src/app/router.tsx`, add the import:

```tsx
import { VolunteersScreen } from '../features/settings/volunteers'
```
add right after it:
```tsx
import { AdminsScreen } from '../features/settings/admins'
```

Add the route, right after the existing `/admin/volunteers` route block:

```tsx
      <Route
        path="/admin/admins"
        element={
          <RequireRole role="admin">
            <AdminsScreen />
          </RequireRole>
        }
      />
```

- [ ] **Step 4: Add the nav link on the dashboard**

In `src/features/ledger/MasterLedger.tsx`, add a new `Link` right after the existing "Manage volunteers" link:

```tsx
        <Link to="/admin/volunteers" className="text-orange-700 underline">
          {strings.admin.volunteersLink}
        </Link>
        <Link to="/admin/admins" className="text-orange-700 underline">
          {strings.admin.adminsLink}
        </Link>
```

- [ ] **Step 5: Add a test for the new nav link**

Add to `tests/MasterLedger.test.tsx`, alongside the "Collect donation" link test from Task 3:

```tsx
  it('links to the admin management screen', async () => {
    fetchFullLedger.mockResolvedValue(balancedLedger)
    renderScreen()

    await waitFor(() => expect(screen.getByRole('link', { name: 'Manage admins' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Manage admins' })).toHaveAttribute('href', '/admin/admins')
  })
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run typecheck && npm run test -- --run`
Expected: all pass. (No dedicated component test exists for `AdminsScreen` itself, matching the existing `VolunteersScreen`, which also has no component test — both are direct-Supabase-call screens verified manually against the live project, same as noted in the design doc's Testing section.)

- [ ] **Step 7: Manual verification against the live Supabase project**

With the dev server running (`npm run dev`) and logged in as an admin at `/login`:
1. Navigate to `/admin/admins`.
2. Add a second admin with a real email you can check.
3. Confirm the new row appears with "Pending" status.
4. Log out, go to `/login`, request a magic link with that second admin's email, click the link in the email.
5. Confirm it lands on `/admin` (not `/login` or a volunteer route) and the row's status is now "Active".

- [ ] **Step 8: Commit**

```bash
git add src/features/settings/admins.tsx src/app/router.tsx src/lib/strings.ts src/features/ledger/MasterLedger.tsx tests/MasterLedger.test.tsx
git commit -m "Add admin management screen, mirroring the volunteer-invite pattern"
```

---

## Post-plan manual step (not code, tracked here for visibility)

Run this once against the live Supabase project (already communicated to the user separately, included here so the plan fully covers the design doc):

```sql
insert into users (name, email, role) values ('Khush Ramnani', 'khushramnani@gmail.com', 'admin');
```

Then log in at `/login` with that email to become the first admin — from there, Task 8's `/admin/admins` screen can be used to add further admins instead of raw SQL.
