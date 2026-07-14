# Implementation Plan: Vinayak Mandal — Digital Vargani & Fund Management

## Overview

Build a single-mandal, zero-cost, mobile-first PWA (React + Vite + Supabase) that replaces a paper
bill book. Work is sliced vertically: each task ships one complete, testable path. The money-correctness
core (`reconcile.ts`, `money.ts`) is built and tested before any feature depends on it, and every
financial write is append-only (void, never edit). See `SPEC.md` for the full specification.

## Architecture Decisions

- **Integer paise everywhere.** No floats for money. `money.ts` is the only place rupees↔paise convert.
- **Append-only ledger.** Donations/expenses/handovers are never edited; corrections are voids + re-entry. Keeps a tamper-evident trail cheaply.
- **Pure reconciliation core.** All cash-in-hand and books-balance math lives in pure functions with no I/O, so it is exhaustively unit-testable independent of DB or UI.
- **Offline-tolerant capture, online-only send.** Dexie queue guarantees no entry is lost on bad signal; the receipt SMS only fires once the row has synced (receipt link needs the server).
- **Trust-based payments.** Mode is recorded (drives cash-in-hand + receipt stamp) but online money is never verified. No gateway, no pending state.
- **Two visual worlds.** Fast utilitarian tool (volunteer/admin) vs. traditional devotional receipt/transparency pages — separate styling, same codebase.
- **Auth split.** Supabase email magic link for admin; app-generated invite tokens (shared over WhatsApp) for volunteers.

## Dependency Graph

```
Supabase schema + RLS + money.ts + reconcile.ts (+ tests)
        │
        ├── Auth (admin magic link, volunteer invite token)
        │       │
        │       ├── Collection flow (form → row → SMS deep link)
        │       │       └── Public receipt page (reads by public_token)
        │       │
        │       ├── Offline queue + sync (wraps collection)
        │       │
        │       ├── Expenses
        │       ├── Handovers
        │       │
        │       └── Cash-in-hand + Master ledger + books-balance check
        │                   └── Transparency report (public)
        │
        └── Settings (mandal_config) — needed for receipt branding
```

## Task List

### Phase 0: Foundation
- [ ] **Task 1 — Scaffold + tooling.** Vite + React + TS + Tailwind + PWA plugin, ESLint/Prettier, Vitest, Playwright, router. App boots, installable shell, CI-runnable scripts. *(S)*
- [ ] **Task 2 — Supabase schema + RLS + seed.** Migrations for `mandal_config`, `users`, `donations`, `expenses`, `handovers`; sequence for `receipt_no`; RLS policies; `seed.sql`; generated TS types. *(M)*
- [ ] **Task 3 — Money + reconciliation core.** `money.ts` (paise/₹, integer-safe) and `reconcile.ts` (cash-in-hand, totals, books-balance identity) as pure functions, with exhaustive unit tests incl. void handling. *(M)*

### Checkpoint: Foundation
- [ ] `typecheck`, `lint`, `test` all pass; `reconcile.ts` + `money.ts` at 100% coverage; migrations apply cleanly; app boots and is installable.

### Phase 1: Auth + Settings
- [ ] **Task 4 — Admin auth.** Supabase email magic-link login; protected admin routes; session → acting user id. *(M)*
- [ ] **Task 5 — Volunteer invite links.** Admin creates a volunteer → generates `invite_token`; opening the link establishes a volunteer session; role-gated routing. *(M)*
- [ ] **Task 6 — Settings / mandal config.** Screen to set name, logo, president signature, UPI VPA/QR, expense categories, bank opening balance; assets to Supabase Storage. *(M)*

### Checkpoint: Auth + Settings
- [ ] Admin can log in; admin can create a volunteer and the invite link logs them in as that volunteer; config values persist and are readable by the receipt/branding layer.

### Phase 2: Core collection loop (the product)
- [ ] **Task 7 — Collection form → donation row.** Name/phone/amount/mode form with validation; server allocates `receipt_no` + `public_token`; row stamped with session user. *(M)*
- [ ] **Task 8 — SMS deep-link send.** On submit, build `sms:` deep link with pre-filled message + receipt URL and open native composer; "Pending send" tray for unsent receipts. *(S)*
- [ ] **Task 9 — Public receipt page.** Route `/r/:public_token` renders parchment + Ganesha watermark + dynamic CASH/ONLINE stamp + president signature + amount + receipt no; donor phone hidden. *(M)*
- [ ] **Task 10 — Offline queue + sync.** Dexie queue: writes land locally first, sync on reconnect, then allow SMS send; no data loss with network off. *(M)*

### Checkpoint: Core loop
- [ ] End-to-end: enter donation → SMS composer opens with working link → donor opens receipt and sees correct stamp/branding. Offline entry survives and syncs. Playwright covers both.

### Phase 3: Money management
- [ ] **Task 11 — Expenses.** Log expense (category, amount, description, paid_from cash/bank); list; void-to-correct. *(M)*
- [ ] **Task 12 — Handovers.** Volunteer records cash handed to treasurer; admin sees handovers; void-to-correct. *(S)*
- [ ] **Task 13 — Cash-in-hand views.** Volunteer sees own cash-in-hand; admin sees per-volunteer breakdown; both driven by `reconcile.ts`. *(M)*
- [ ] **Task 14 — Void flow (shared).** Reusable void action (reason required) for donations/expenses/handovers; voided rows shown struck-through with reason; recalcs cash-in-hand. *(S)*

### Checkpoint: Money management
- [ ] Voiding a cash donation and recording a handover both move the right volunteer's cash-in-hand by the exact amount; voided rows remain visible with reasons.

### Phase 4: Dashboards & transparency
- [ ] **Task 15 — Master ledger + books-balance light.** Admin dashboard: total collected, total expenses, net balance, and green/red reconciliation indicator with discrepancy amount. *(M)*
- [ ] **Task 16 — Transparency report (public).** Public route: total collected + spend-by-category Recharts pie; zero individual donor names/amounts; admin publish toggle. *(M)*

### Checkpoint: Complete
- [ ] All success criteria in SPEC.md met; books-balance identity proven by tests; transparency page leaks no donor data; Lighthouse PWA installable; usable at 360px. Ready for review.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `sms:` deep-link behavior differs iOS vs Android (body prefill, length) | Med | Feature-detect; fall back to copy-link + share sheet; test on both; keep message short. |
| Float rounding corrupts money | High | Integer paise only; `money.ts` is the sole conversion point; 100% unit coverage. |
| Sequential `receipt_no` gaps/races under concurrent inserts | Med | Allocate via Postgres sequence / transactional counter server-side, never client. |
| Offline sync conflicts or duplicate sends | Med | Client-generated idempotency key per queued entry; server dedupes; mark sent only after confirmed sync. |
| RLS misconfig leaks donor phone to public receipt/transparency | High | Public routes read a restricted view exposing only safe columns; RLS tested; donor phone never in public payload. |
| Reconciliation identity subtly wrong | High | Encode identity as tested pure function; dashboard shows discrepancy, not just red/green, to aid debugging. |

## Open Questions (mirror SPEC.md)

- Volunteers allowed to log expenses, or admin-only?
- Transparency report always-live vs. published/frozen at festival end?
- English-only v1 with i18n-ready strings — confirm.

## Parallelization

- After Phase 0+1: Public receipt page (Task 9) can proceed in parallel with Expenses/Handovers (Tasks 11–12) once the donation schema and `reconcile.ts` exist.
- Sequential: schema (Task 2) → everything; offline queue (Task 10) wraps the collection flow (Tasks 7–8) so it comes after.
