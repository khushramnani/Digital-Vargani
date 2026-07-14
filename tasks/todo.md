# Todo: Vinayak Mandal Digital Vargani

Ordered by dependency. Each task is one focused session (≤ ~5 files). Void = correction; never edit money rows.
Full detail per task in `plan.md`; full spec in `SPEC.md`.

## Phase 0 — Foundation

- [ ] **Task 1: Scaffold + tooling**
  - Acceptance: Vite+React+TS+Tailwind app boots; PWA installable shell; ESLint/Prettier/Vitest/Playwright/router wired.
  - Verify: `npm run dev`, `npm run build`, `npm run lint`, `npm run test` all succeed.
  - Files: `package.json`, `vite.config.ts`, `src/app/*`, config files.

- [ ] **Task 2: Supabase schema + RLS + seed**
  - Acceptance: migrations create all 5 tables + `receipt_no` sequence + RLS; `seed.sql` loads a config row, 1 admin, 2 volunteers; TS types generated.
  - Verify: `supabase db push` clean; `npm run db:types`; a seeded query returns rows respecting RLS.
  - Files: `supabase/migrations/*.sql`, `supabase/seed.sql`, `src/lib/db/*`.

- [ ] **Task 3: Money + reconciliation core**
  - Acceptance: `money.ts` (integer-safe paise↔₹) and `reconcile.ts` (cash-in-hand, totals, net balance, books-balance identity) as pure functions; void rows excluded.
  - Verify: `npm run test` — 100% coverage on both files, incl. void + balance-identity cases.
  - Files: `src/lib/money.ts`, `src/lib/reconcile.ts`, `*.test.ts`.

### ✅ Checkpoint: Foundation — typecheck/lint/test green, core at 100%, migrations apply, app installable.

## Phase 1 — Auth + Settings

- [ ] **Task 4: Admin auth (email magic link)**
  - Acceptance: admin logs in via Supabase magic link; admin routes protected; session resolves to acting user id.
  - Verify: Playwright — unauthenticated redirected; authenticated reaches dashboard.
  - Files: `src/features/auth/*`, `src/app/router.tsx`.

- [ ] **Task 5: Volunteer invite links**
  - Acceptance: admin creates volunteer → `invite_token` link; opening it starts a volunteer session; role-gated routes.
  - Verify: manual + e2e — invite link logs in as that volunteer; volunteer cannot reach admin routes.
  - Files: `src/features/auth/*`, `src/features/settings/volunteers.tsx`.

- [ ] **Task 6: Settings / mandal config**
  - Acceptance: set name, logo, signature, UPI VPA/QR, expense categories, bank opening; assets in Supabase Storage.
  - Verify: values persist; receipt/branding layer reads them; image upload works.
  - Files: `src/features/settings/*`, `src/lib/db/config.ts`.

### ✅ Checkpoint: Auth + Settings — admin login works, invite link works, config persists and is readable.

## Phase 2 — Core collection loop

- [ ] **Task 7: Collection form → donation row**
  - Acceptance: name/phone/amount/mode form, client+DB validation (amount>0, mode enum); server allocates gapless `receipt_no` + unguessable `public_token`; row stamped with session user.
  - Verify: submit creates row; receipt_no sequential; unit test on validation.
  - Files: `src/features/collection/*`, `src/lib/db/donations.ts`.

- [ ] **Task 8: SMS deep-link send**
  - Acceptance: on submit, native SMS composer opens pre-filled with message + receipt URL; unsent receipts appear in "Pending send" tray.
  - Verify: e2e/manual on Android + iOS; ≤3 taps from amount to composer.
  - Files: `src/features/collection/send.ts`, `src/features/collection/PendingSend.tsx`.

- [ ] **Task 9: Public receipt page**
  - Acceptance: `/r/:public_token` renders parchment + Ganesha watermark + dynamic CASH/ONLINE stamp + president signature + amount + receipt no; donor phone NOT shown.
  - Verify: visual check both stamps; confirm phone absent from network payload.
  - Files: `src/features/receipt/*`, `src/components/StampGraphic.tsx`.

- [ ] **Task 10: Offline queue + sync**
  - Acceptance: entries write to Dexie first, sync on reconnect, then allow send; idempotency key prevents duplicates; no loss with network off.
  - Verify: Playwright offline → entry in Pending send → online → syncs + sends once.
  - Files: `src/lib/queue/*`, `src/features/collection/*`.

### ✅ Checkpoint: Core loop — donation → SMS → donor receipt works; offline entry survives + syncs (Playwright green).

## Phase 3 — Money management

- [ ] **Task 11: Expenses**
  - Acceptance: log expense (category, amount, description, paid_from cash/bank); list; void-to-correct.
  - Verify: expense appears in ledger totals; void removes it from totals.
  - Files: `src/features/expenses/*`, `src/lib/db/expenses.ts`.

- [ ] **Task 12: Handovers**
  - Acceptance: volunteer records cash handed to treasurer; admin sees handovers list; void-to-correct.
  - Verify: handover reduces that volunteer's cash-in-hand by exact amount.
  - Files: `src/features/cashinhand/handover.tsx`, `src/lib/db/handovers.ts`.

- [ ] **Task 13: Cash-in-hand views**
  - Acceptance: volunteer sees own cash-in-hand; admin sees per-volunteer breakdown; both from `reconcile.ts`.
  - Verify: matches hand-computed values against seed data.
  - Files: `src/features/cashinhand/*`.

- [ ] **Task 14: Shared void flow**
  - Acceptance: reusable void action (reason required) for donations/expenses/handovers; voided rows shown struck-through with reason; recalcs cash-in-hand.
  - Verify: e2e — void cash donation → volunteer cash-in-hand drops by amount; row still visible as voided.
  - Files: `src/components/VoidButton.tsx`, `src/lib/db/void.ts`.

### ✅ Checkpoint: Money management — void + handover move the right cash-in-hand exactly; voided rows remain auditable.

## Phase 4 — Dashboards & transparency

- [ ] **Task 15: Master ledger + books-balance light**
  - Acceptance: dashboard shows total collected, total expenses, net balance, and green/red reconciliation indicator with discrepancy amount.
  - Verify: force an imbalance in test data → indicator red with correct delta; balanced → green.
  - Files: `src/features/ledger/*`.

- [ ] **Task 16: Transparency report (public)**
  - Acceptance: public route shows total collected + spend-by-category pie (Recharts); no individual donor names/amounts; admin publish toggle.
  - Verify: confirm payload has no donor rows; pie sums to total expenses.
  - Files: `src/features/transparency/*`.

### ✅ Checkpoint: Complete — all SPEC.md success criteria met; balance identity tested; no donor leakage; PWA installable at 360px. Ready for review.
