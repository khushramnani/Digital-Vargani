# Design: Admin management, admin-as-volunteer, WhatsApp send, VYM rebrand

## Context

The app (SPEC.md) currently has one auth-gated role split: admin (email magic
link) and volunteer (invite-token link, no UI to create admins). This work
adds admin account management mirroring the existing volunteer-invite
pattern, lets an admin also use the volunteer collection flow, adds a
WhatsApp send option alongside the existing SMS deep link, and renames the
product from "Vinayak Mandal" to "Vinayak Yuvak Mandal (VYM)" in
user-facing/formal spots.

No new tables or RLS policies are needed anywhere in this design — every
piece below is covered by existing schema and existing `is_admin()`-gated
policies from `supabase/migrations/20260714111950_schema_and_rls.sql`.

## 1. Rebrand to "Vinayak Yuvak Mandal (VYM)"

- `src/lib/strings.ts`: `appName` → `'Vinayak Yuvak Mandal (VYM)'`. This is
  shown on the home screen headline and used as the receipt-branding
  fallback (`ReceiptPage.tsx`'s `branding?.name ?? strings.appName`).
- `vite.config.ts` PWA manifest: `name: 'Vinayak Yuvak Mandal'`,
  `short_name: 'VYM'` (short_name has a hard ~12-character practical limit
  for home-screen icon labels on Android/iOS — this is a platform
  constraint, not a style choice).
- `index.html` `<title>`.
- `SPEC.md` header line (living spec doc).
- **Out of scope**: `package.json`'s internal `"name"` field (not
  user-facing); the historical `.superpowers/sdd/task-*-report.md` files
  (point-in-time records, not living docs); `mandal_config.name` in the
  database (admin-editable live data via the Settings screen — not
  overwritten by this change; noted to the user separately).

## 2. First admin bootstrap

No code change. One-time SQL, run by the user directly against their
Supabase project (outside this session's DB access):

```sql
insert into users (name, email, role) values ('Khush Ramnani', 'khushramnani@gmail.com', 'admin');
```

`link_admin_account()` (existing RPC, `20260714121305_add_users_email.sql`)
auto-links this row to the Supabase Auth identity on first magic-link login
at `/login`.

## 3. Admin management screen (`/admin/admins`)

New `AdminsScreen` component (`src/features/settings/admins.tsx`), routed
behind `RequireRole role="admin"`. Same list + add-form shape as the
existing `VolunteersScreen` (`src/features/settings/volunteers.tsx`), with
two differences:

- **No invite token / copy-link UI.** An admin's "invite" is simply
  requesting a magic link at `/login` with the email just added — Supabase's
  own email delivery *is* the invite. The add-form is name + email only.
- **Insert**: `{ name, email, role: 'admin' }` via
  `supabase.from('users').insert(...)`. Covered by the existing
  `users_admin_insert` RLS policy (`with check (is_admin())`).
- **List**: `supabase.from('users').select('*').eq('role', 'admin')`,
  covered by the existing `users_admin_select` policy. Status per row:
  "Active" if `auth_user_id` is set, "Pending" otherwise (same convention as
  `VolunteersScreen`).
- **Validation**: name required; email required with a light format check
  (mirrors the existing phone-format check style in
  `lib/validation/donation.ts` — not full RFC 5322). The DB's
  `users.email unique` constraint is the source of truth for duplicates;
  a unique-violation surfaces as an inline form error the same way
  `VolunteersScreen` surfaces `insertError.message` today.

Nav: add an "Manage admins" link on `MasterLedgerScreen`
(`src/features/ledger/MasterLedger.tsx`), alongside the existing
"Manage volunteers" link. New string keys under `strings.admins.*` and one
new key `strings.admin.adminsLink`.

Router: add `/admin/admins` to `src/app/router.tsx`, same shape as the
existing `/admin/volunteers` route.

## 4. Admin can act as volunteer

**Root cause**: `RequireRole` (`src/features/auth/RequireRole.tsx`) checks
`appUser?.role !== role` — exact string match against a single role. Routes
under `/volunteer/*` require `role="volunteer"` exactly, so an
authenticated admin hitting `/volunteer` is redirected to `/login` even
though the DB already permits it — `donations_admin_insert` has no
`collected_by` restriction (unlike `donations_volunteer_insert`, which
requires `collected_by = app_user_id()`).

**Fix**: widen `RequireRole` to accept `role: Role | Role[]`, checking
membership instead of equality. Apply `role={['admin', 'volunteer']}` to the
three routes that only admins currently can't reach as themselves:
`/volunteer` (`CollectionForm`), `/volunteer/pending` (`PendingSend`),
`/volunteer/collections` (`CollectionsScreen`). These three don't already
have an `/admin/...` equivalent for *logging* a donation (unlike expenses,
handovers, and cash-in-hand, which already have separate `/admin/*` routes
an admin can reach). `/admin/collections` (view-only list) is untouched.

No changes to `CollectionForm.tsx`, `PendingSend.tsx`, or any `lib/db/*`
query — they already key everything off `appUser.id` generically, not off
`appUser.role`.

Nav: add a "Collect donation" link on `MasterLedgerScreen` pointing to
`/volunteer`.

## 5. WhatsApp send option

`src/features/collection/send.ts` gains:

```ts
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`
}

export function sendReceiptWhatsApp(donation: Donation): void {
  const message = strings.collection.smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token))
  window.open(buildWhatsAppLink(donation.donor_phone ?? '', message), '_blank')
  markSmsSent(donation.id).catch(() => {})
}
```

Bare 10-digit Indian mobile numbers get `91` prepended (per confirmed
default); anything else (already has a country code, or is some other
length) is passed through as-is — this matches the existing donor-phone
validation in `lib/validation/donation.ts`, which only checks digit-count
range (7–15), not a specific format.

Both channels funnel through the same `markSmsSent` bookkeeping — this
column means "has a receipt been sent for this donation" for the purposes
of the Pending Send tray gate, not "was it sent via SMS specifically", so
reusing it for WhatsApp sends needs no migration or rename.

**UI changes**:
- `CollectionForm.tsx`'s post-submit success panel: the single "Send
  Receipt" button becomes two buttons, "Send via SMS" / "Send via
  WhatsApp", calling `sendReceiptSms` / `sendReceiptWhatsApp` respectively.
- `PendingSend.tsx`'s per-row action: same split, two small buttons instead
  of one "Send" button.
- New string keys: `strings.collection.sendReceiptSmsButton`,
  `sendReceiptWhatsAppButton`; `strings.pendingSend.sendSmsButton`,
  `sendWhatsAppButton` (replacing the single `sendReceiptButton` /
  `sendButton` keys).

## Testing

- Unit tests for `buildWhatsAppLink`'s phone normalization (bare 10-digit,
  already-prefixed with a country code, formatted with spaces/dashes/
  parens), alongside the existing `buildSmsLink` tests in
  `send.test.ts`.
- Unit test for `RequireRole` accepting an array and correctly allowing an
  admin through a `['admin', 'volunteer']` route while still blocking a
  volunteer from an `role="admin"`-only route.
- Playwright: extend existing critical-flow specs to cover an
  authenticated admin reaching `/volunteer` and logging a donation, and the
  two-button send choice appearing after a successful submit.
- Manual: admin-management add/list flow (no automated DB fixture for a
  second admin identity exists yet, so this is a manual pass against the
  live Supabase project, same as the existing volunteer-invite flow's
  testing story).

## Boundaries carried over from SPEC.md

- No new dependency (the WhatsApp link is a plain `https://wa.me/` deep
  link — no WhatsApp Business API, no paid integration).
- No RLS/migration changes.
- Every donation/expense/handover write still stamped from the session's
  `appUser.id`, never form-supplied — unchanged by any of the above.
