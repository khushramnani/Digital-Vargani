# Spec: Vinayak Yuvak Mandal (VYM) — Digital Vargani & Fund Management System

> Multi-tenant, zero-cost, mobile-first PWA that replaces a paper bill book for door-to-door
> festival donation collection, receipt delivery, and fund/cash reconciliation.
> Companion design: Claude Design "Vinayak Mandal" (shared separately).
> Product brief: `ganesh-mandal-project-brief.md`.

## Assumptions (correct these before building)

1. **Stack:** React 18 + TypeScript + Vite, Tailwind CSS, PWA via `vite-plugin-pwa`, IndexedDB (Dexie) for the offline write-queue, Supabase (Postgres + RLS) as the backend, Recharts for the transparency pie chart, deployed to Vercel or Cloudflare Pages. All chosen because they are free-tier / zero running cost. **Swap freely — nothing below depends on a specific vendor except the SQL, which is Postgres-flavored.**
2. **Multi-tenant.** Each mandal is a row in `mandals`, holding its identity (name, slug, logo, signature, UPI VPA/QR, expense categories, receipt-number prefix). Every table carries a `mandal_id`; `users.mandal_id` is the tenant key, read through `app_mandal_id()` and enforced by RLS on every policy. One account belongs to exactly one mandal. Mandals are created only by the `create_mandal()` RPC (self-serve signup, one mandal per verified email).
3. **Trust-based payments.** No payment gateway, no payment-status/pending state, no UTR capture, no online-payment verification. Donor shows they paid → volunteer logs it → receipt sent → entry is final.
4. **Zero messaging cost.** Receipts are sent by the volunteer's own SMS app via an `sms:` deep link. No SMS gateway.
5. **Language:** Operator UI (volunteer/admin) is English, in `src/lib/strings.ts`. Donor-facing copy — the receipt page and the SMS/WhatsApp body — is available in English, Marathi, Hindi and Gujarati from `src/lib/i18n/receipt.ts`, selected per-send by the volunteer and carried on the receipt link as `?lang=`. The mandal's `default_lang` preselects it. Unknown/absent `?lang=` falls back to English.
6. **Currency:** INR only. Amounts stored as integer paise to avoid float errors; displayed as ₹.

## Objective

Give a neighborhood Ganesh Mandal three things at zero cost:
- **Volunteers** — a frictionless phone screen to log a donation at a doorstep and send an official-looking receipt in seconds, even on patchy signal.
- **Admin (President/Treasurer)** — a live view of all money in and out, and — the headline feature — exactly how much cash each volunteer is still holding.
- **Donors** — a receipt that feels as trustworthy and traditional as a stamped paper one.

**Success looks like:** a treasurer can, at any moment, see the net balance and each volunteer's cash-in-hand without a single manual tally, and the books self-check as balanced.

### Primary user stories

- As a **volunteer**, I enter donor name, phone, amount, and mode, submit, and my phone's SMS app opens pre-filled with the receipt link so I just press Send.
- As a **volunteer** on bad signal, my entry is never lost — it queues locally and sends when I get signal.
- As a **volunteer**, I can see how much cash I'm holding and record when I hand it to the treasurer.
- As an **admin**, I log expenses, see the master ledger and net balance, and see every volunteer's cash-in-hand.
- As an **admin**, I get a books-balance indicator that turns red if numbers don't reconcile.
- As a **donor**, I open an SMS link and see a parchment-style receipt with a Ganesha watermark, a CASH/ONLINE stamp, and the president's signature.
- As **anyone**, I open the public transparency link and see totals collected and a spend breakdown pie chart — with no individual donor names or amounts.

## Tech Stack

- React 18, TypeScript, Vite
- Tailwind CSS
- `vite-plugin-pwa` (+ Workbox) for installability and the service worker
- Dexie (IndexedDB) for the offline write-queue
- Supabase: Postgres, Row Level Security, Auth (admin email magic link), Storage (legacy branding assets; new uploads go to Cloudinary via the sign-upload edge function)
- Recharts (transparency pie chart)
- React Router
- Deploy: Vercel or Cloudflare Pages (free tier)

## Commands

```
Install:  npm install
Dev:      npm run dev
Build:    npm run build
Preview:  npm run preview
Lint:     npm run lint
Test:     npm run test          # Vitest (unit) + React Testing Library
E2E:      npm run test:e2e      # Playwright (critical flows)
Types:    npm run typecheck
DB types: npm run db:types      # supabase gen types typescript
Migrate:  supabase db push      # apply SQL migrations to the project
```

## Project Structure

```
src/
  app/                 → Router, providers, PWA registration
  features/
    collection/        → Volunteer donation form + receipt-send flow
    receipt/           → Public donor receipt page (Module B)
    ledger/            → Admin master ledger + reconciliation check
    expenses/          → Expense logging
    cashinhand/        → Per-volunteer cash tracker + handovers
    transparency/      → Public community report (Module D)
    auth/              → Magic-link login (admin) + invite links (volunteers)
    settings/          → Mandal config screen
  lib/
    db/                → Supabase client + typed queries
    queue/             → Dexie offline queue + sync engine
    money.ts           → paise <-> ₹ helpers (integer-safe)
    reconcile.ts       → cash-in-hand + books-balance calculations (pure fns)
    strings.ts         → all user-facing copy (i18n-ready)
  components/          → Shared UI (Button, Field, StampGraphic, etc.)
supabase/
  migrations/          → SQL schema + RLS policies
  seed.sql             → dev seed data
tests/                 → Vitest unit tests (co-located *.test.ts also allowed)
e2e/                   → Playwright specs
tasks/                 → plan.md + todo.md
```

## Data Model (Postgres)

All money in **integer paise**. All tables append-only in spirit: **no row is ever edited except to void it.** Corrections are made by voiding and re-entering.

```sql
-- One row per mandal. The tenant root; created only by create_mandal().
mandals (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique                       -- public URL: /transparency/:slug
                    check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  logo_url          text,
  signature_url     text,          -- president signature image
  upi_vpa           text,
  upi_qr_url        text,
  receipt_prefix    text not null default 'VM',
  default_lang      text not null default 'en'                  -- donor receipt/message language
                    check (default_lang in ('en','mr','hi','gu')),
  expense_categories text[] not null default '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}',
  bank_opening_paise bigint not null default 0,
  transparency_published boolean not null default false,
  next_receipt_no   bigint not null default 1,  -- per-mandal receipt counter
  created_at        timestamptz not null default now()
)

users (
  id            uuid primary key default gen_random_uuid(),
  mandal_id     uuid not null references mandals(id),
  name          text not null,
  phone         text,
  role          text not null check (role in ('admin','volunteer')),
  invite_token  text unique,       -- volunteer magic link token; null once admin
  auth_user_id  uuid,              -- links to Supabase auth for admins
  active        boolean not null default true,
  created_at    timestamptz not null default now()
)

donations (
  id            uuid primary key default gen_random_uuid(),
  mandal_id     uuid not null references mandals(id),
  receipt_no    bigint not null,           -- sequential per mandal; unique (mandal_id, receipt_no)
  public_token  text not null unique,      -- unguessable receipt URL slug
  donor_name    text not null,
  donor_phone   text,
  amount_paise  bigint not null check (amount_paise > 0),
  mode          text not null check (mode in ('cash','upi','bank')),
  collected_by  uuid not null references users(id),
  created_at    timestamptz not null default now(),
  -- void (correction) fields; amount/donor NEVER edited
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
)

expenses (
  id            uuid primary key default gen_random_uuid(),
  mandal_id     uuid not null references mandals(id),
  category      text not null,
  amount_paise  bigint not null check (amount_paise > 0),
  description   text,
  paid_by       uuid not null references users(id),
  paid_from     text not null check (paid_from in ('cash','bank')),
  created_at    timestamptz not null default now(),
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
)

handovers (                                   -- volunteer hands cash to treasurer
  id            uuid primary key default gen_random_uuid(),
  mandal_id     uuid not null references mandals(id),
  volunteer_id  uuid not null references users(id),
  amount_paise  bigint not null check (amount_paise > 0),
  received_by   uuid not null references users(id),  -- admin
  note          text,
  created_at    timestamptz not null default now(),
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
)
```

`receipt_no` is allocated server-side from `mandals.next_receipt_no`, incremented under a row lock in the insert trigger, so numbers are gapless and unique **per mandal** — two mandals both holding receipt #1 is correct, not a collision. `mandal_id` is likewise stamped by the trigger from the session, never accepted from the client: the trigger writes `coalesce(app_mandal_id(), new.mandal_id)`, so a real session always wins and a forged `mandal_id` is overwritten. The fallback exists only for the table owner seeding data (which bypasses RLS anyway); a caller with no `users` row is rejected by RLS before it could matter. `public_token` uses a 16+ char url-safe random id.

### Derived calculations (pure functions in `lib/reconcile.ts`)

Only **non-voided** rows count.

```
volunteerCashInHand(v) =
    Σ donations.amount where mode='cash' and collected_by=v
  − Σ expenses.amount   where paid_from='cash' and paid_by=v
  − Σ handovers.amount  where volunteer_id=v

totalCollected   = Σ donations.amount (all modes)
totalExpenses    = Σ expenses.amount (all)
netBalance       = totalCollected − totalExpenses

-- Books-balance self-check (must hold true, else flag red):
Σ over volunteers of volunteerCashInHand
  + cashHeldByTreasurer            (Σ handovers.amount − Σ expenses paid_from='cash' by admin)
  + bankBalance                    (bank_opening + Σ donations mode in ('upi','bank') − Σ expenses paid_from='bank')
  == netBalance + bank_opening
```
The exact identity is implemented and unit-tested in `reconcile.ts`; the dashboard shows a green ✓ when it holds and a red ✗ with the discrepancy amount when it doesn't.

## Screens

**Volunteer (phone):** magic-link login · collection form (primary) · pending-send tray · my collections · my cash-in-hand · log cash expense · handover to treasurer.
**Admin (phone + desktop):** dashboard (master ledger + books-balance light) · all collections · expenses · volunteers & cash-in-hand · handovers · settings (mandal config) · transparency report preview/publish.
**Public (no login):** digital receipt page · community transparency report.

## Auth

- **Signup:** anyone can create a mandal via email magic link → `create_mandal(mandal_name, admin_name, slug_hint)`, becoming its first admin. Anonymous (volunteer) sessions are rejected. One mandal per verified email, enforced by the database. `slug_hint` is optional and lets the founder choose their own public link — it matters because `slugify()` is ASCII-only, so a mandal named गणेश मंडळ would otherwise land on `mandal`, `mandal-2`, `mandal-3`… defeating the point of a readable link. The hint is slugified and uniqueness-checked like any other candidate, never trusted raw.
- **Admin:** Supabase email magic link (admin has an email).
- **Volunteer:** admin creates the user; app generates an `invite_token`; admin shares the link over WhatsApp; opening it establishes a long-lived session bound to that user. No passwords, no OTP.
- Every donation/expense/handover is stamped with the acting user's id from the session — never user-supplied.

## Code Style

TypeScript strict. Functional React components + hooks. Money never touches floats.

```ts
// lib/money.ts — always integer paise internally
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const formatINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

// Pure, testable domain logic — no I/O inside calculations
export function volunteerCashInHand(v: UserId, ledger: Ledger): number {
  const cashIn = sumWhere(ledger.donations, d => d.mode === "cash" && d.collectedBy === v && !d.voided);
  const cashOut = sumWhere(ledger.expenses, e => e.paidFrom === "cash" && e.paidBy === v && !e.voided);
  const handed = sumWhere(ledger.handovers, h => h.volunteerId === v && !h.voided);
  return cashIn - cashOut - handed;
}
```

Conventions: `camelCase` vars/functions, `PascalCase` components/types, feature-first folders, one screen per route, all copy via `strings.ts`, no inline hex (Tailwind tokens only).

## Testing Strategy

- **Vitest + React Testing Library** for units and components. Co-located `*.test.ts(x)` or under `tests/`.
- **Reconciliation logic (`reconcile.ts`, `money.ts`) must have exhaustive unit tests** — this is the money-correctness core, including void handling and the books-balance identity. Target 100% on these files.
- **Playwright** for the four critical flows: log donation → SMS deep link fires; offline queue → sync on reconnect; void → cash-in-hand updates; handover → cash-in-hand zeroes.
- Coverage: ≥80% overall, 100% on `lib/reconcile.ts` and `lib/money.ts`.

## Boundaries

- **Always:** store money as integer paise; stamp entries with the session user; scope every RLS policy and every mandal-taking SECURITY DEFINER RPC by `app_mandal_id()`; stamp `mandal_id` server-side, never from the client; keep entries append-only (void, never edit); run `typecheck` + `test` before commit; validate amount > 0 and mode ∈ enum on both client and DB; derive the upload folder from the caller's JWT in `sign-upload`, never from the request body.
- **Ask first:** any change to the data model / migrations; adding a dependency; introducing any paid service or payment gateway; changing the reconciliation identity; touching RLS policies.
- **Never:** edit a donation/expense/handover amount after creation; hard-delete a financial row; expose donor phone on the public receipt or transparency page; show individual donor names/amounts on the transparency page; expose an RPC that takes a mandal identifier and returns unpublished or donor-level data without an `app_mandal_id()` check; commit Supabase keys/secrets; commit or persist Cloudinary credentials; return the Cloudinary API secret from an edge function; translate a mandal name or a donor name (only fixed receipt/message copy is translated, never proper nouns).

## Success Criteria

1. A volunteer can log a donation and reach the pre-filled SMS composer in ≤ 3 taps after entering the amount.
2. With the network disabled mid-collection, the entry persists and appears in "Pending send"; re-enabling network syncs it and allows sending, with no data loss.
3. The public receipt renders parchment + Ganesha watermark + correct CASH/ONLINE stamp + president signature + amount + sequential receipt number, and does **not** show the donor phone.
4. Voiding a cash donation immediately decreases that volunteer's cash-in-hand by the exact amount; the original row remains visible as voided with its reason.
5. A handover reduces the volunteer's cash-in-hand by the handed amount.
6. The dashboard books-balance indicator is green when the reconciliation identity holds and red (with the discrepancy) when it doesn't; `reconcile.ts` unit tests prove the identity.
7. The transparency page shows total collected and a spend-by-category pie chart with zero individual donor data.
8. Lighthouse PWA installable; usable one-handed on a low-end Android viewport (360px).

## Open Questions

1. Should volunteers be allowed to log **expenses**, or admin-only? (Spec assumes volunteers can log cash expenses they personally paid; flip if not.)
2. Should the transparency report be **always-live** or **published/frozen** at festival end? (Assumed: admin toggles "publish".)
3. Bank opening balance and any pre-festival funds — captured in `mandals.bank_opening_paise`; confirm that's sufficient.
4. ~~English-only for v1~~ — **resolved.** Operator UI is English; donor-facing receipt + message copy ships in English, Marathi, Hindi and Gujarati. Those translations shipped without native-speaker review — approved by the repo owner as-is — so a native-speaker pass remains outstanding. Translating the operator UI is deferred until a mandal asks.
