# Plan: Daily Collection View, Date Filter, Totals & Search (2026-08-16)

> Feature request: (1) Admin dashboard shows **today's collection** and a **pick-a-date**
> view of any day's collection; (2) the **Collections** screen gets a **date filter**
> (Today / specific day), a **running total** for whatever is filtered, and a **search bar**
> to find a specific person's collections.
>
> ⚠️ **The product is LIVE with real users and real donation records.**
> This plan is **read-only / additive**: **zero changes to existing tables, rows, RLS
> policies, triggers, or RPCs. No destructive migration of any kind.** See §6.

---

## 0. Codebase context (verified against current source)

- Admin dashboard = `src/features/ledger/MasterLedger.tsx` (`MasterLedgerContent`), routed at
  `/admin` inside `AdminLayout`'s `<Outlet/>`. It already fetches
  `fetchFullLedger()`, `fetchActiveVolunteers()`, `getExpenses()`, `getDonations()`.
- Collections list = `src/features/collection/Collections.tsx` (`CollectionsContent`),
  shared by **admin** (`/admin/collections`) and **volunteer** (`/collect/history`).
  RLS scopes rows per role server-side, so one component serves both. It already has
  two filters (source `category`, year) — the new filters/search slot into that same bar.
- `getDonations()` (`src/lib/db/donations.ts`) returns full rows **capped at 1000**,
  newest first. Fine for the list; **not** safe for money totals (a big season could
  exceed 1000 rows and silently undercount). §3 adds an uncapped *lite* query for totals.
- Money is integer **paise** (`lib/money.ts`), all user copy goes through `lib/strings.ts`,
  domain math lives in pure, unit-tested functions (`lib/reconcile.ts` pattern).
- `donations.created_at` is `timestamptz`, server-set by trigger; rows are append-only
  (void, never edit). Only **non-voided** rows may ever feed a total.
- Existing UI patterns to copy: search input + year `<select>` in
  `src/features/donors/Donors.tsx`; stat tiles = `StatCard` in `MasterLedger.tsx`.

---

## 1. New pure helpers — `src/lib/dayFilter.ts` (new file)

Small, pure, exhaustively unit-testable (same philosophy as `reconcile.ts`). No I/O.

```ts
// A calendar day in the DEVICE'S LOCAL timezone (users are in IST).
// Never compare the UTC date part of the ISO string — a donation at
// 11:30 PM IST is stored as 18:00 UTC and must still count as "today".
export function isOnLocalDay(iso: string, day: Date): boolean {
  const d = new Date(iso)
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  )
}

// "2026-08-16" (from <input type="date">) -> local-midnight Date. Must be
// parsed as LOCAL, not by new Date("2026-08-16") (which parses as UTC).
export function parseLocalDay(value: string): Date | null

// Aggregate one day's donations (NON-VOIDED ONLY):
// { totalPaise, count, byMode: {cash,upi,bank}, byVolunteer: Map<userId, paise> }
export function summarizeDay(donations: DonationLite[], day: Date): DaySummary

// Totals for an arbitrary filtered list (Collections totals bar):
// { totalPaise, count } over non-voided rows.
export function totalsOf(donations: Pick<Donation,'amount_paise'|'voided'>[]): Totals
```

Rules: voided rows never count; amounts stay integer paise end-to-end.

---

## 2. Admin dashboard (`MasterLedger.tsx`)

### 2a. "Today's Collection" stat card — always visible

Add a stat tile to the existing grid (reuse `StatCard`):
label `strings.ledger.todaysCollectionLabel`, value `formatINR(today.totalPaise)`,
sub = `${today.count} donations` (reuse count-suffix pattern). Computed with
`summarizeDay(donationsLite, new Date())`.

Grid note: mobile grid is currently a deliberate 2×2 (`grid-cols-2`, 4th tile
`lg:hidden`). Adding a 5th tile: make today's card full-width **above** the grid
(a slim highlight band) OR extend to 2×3 on mobile — implementer's choice, but do
not break the 360px one-handed layout (SPEC success criterion #8).

### 2b. "Collection by day" card — the date picker

New card (place next to `SourceCard`/`InsightCard` in a `lg:grid-cols-2` row):

- `<input type="date">` defaulting to today, max = today. Quick chips:
  **Today** · **Yesterday** (set the input; chips are sugar, the input is the source of truth).
- For the chosen day render: **total collected** (big number), **donation count**,
  **mode split** (💵 cash / 📱 upi / 🏦 bank with amounts), and a **per-volunteer
  breakdown** — "who collected how much that day" (this is the daily-tally use case:
  volunteers come back in the evening and the treasurer checks the day's take per person).
  Names via the already-fetched `fetchActiveVolunteers()` + `fetchMandalUserNames()`
  fallback for inactive/unknown collectors (label `strings.collections.unknownCollector`).
- Empty state: `strings.ledger.noCollectionsOnDay` ("No collections on this day.").
- All figures from `summarizeDay(donationsLite, selectedDay)` — client-side, instant,
  no refetch on date change.

### 2c. Data source — fix the 1000-row cap for aggregates

Add to `src/lib/db/donations.ts`:

```ts
export type DonationLite = Pick<Donation,
  'amount_paise' | 'mode' | 'category' | 'collected_by' | 'created_at' | 'voided'>

// Uncapped, lightweight (6 columns), RLS-scoped exactly like getDonations().
// Feeds dashboard aggregates; NEVER capped, so day totals can't undercount.
export async function getDonationsLite(): Promise<DonationLite[]>
```

In `MasterLedgerContent`, replace the `getDonations()` fetch with `getDonationsLite()`
and pass it to `SourceCard` / `InsightCard` too (they only use lite fields —
`voided`, `category`, `amount_paise`, `donor_phone`… **note:** `InsightCard` also
uses `donor_name`/`donor_phone` for unique-donor counting → include those two columns
in the lite select as well). This quietly fixes the same undercount bug those two
cards already have today. Volunteer sessions calling it get only their rows (RLS) — unchanged behavior.

---

## 3. Collections screen (`Collections.tsx`)

All additions to the existing filter bar; component stays shared (admin sees all
rows, volunteer sees own rows — RLS already handles it, so a volunteer's "Today"
is automatically *their* today's collection).

### 3a. Search bar

- Text input (copy the `Donors.tsx` search input styling), placeholder
  `strings.collections.searchPlaceholder` ("Search name, phone or receipt #").
- Client-side match over loaded rows (case-insensitive, trimmed):
  `donor_name`, `donor_phone` (raw digits contains), `receipt_no` (string equals/startsWith),
  and — when the names map is populated (admins) — collector name.
- Composes with all other filters (AND).

### 3b. Date filter

- Segmented control / chips: **All** · **Today** · **📅 Pick date** (date input appears
  when picked; max = today). State: `dayFilter: 'all' | 'today' | string(yyyy-mm-dd)`.
- Row predicate uses `isOnLocalDay` / `parseLocalDay` from §1.
- Composes with existing source + year filters and search. Keep the existing
  "filtered to nothing" empty state (`t.noFilterResults`) — do not show the
  scary "no donations yet" state (comment in the file explains why).

### 3c. Totals bar for the filtered view

- A slim summary strip above the list, always visible when there are rows:
  **"Total: ₹X · N donations"** for the CURRENT filter combination
  (`totalsOf(activeFiltered)` — non-voided only; voided rows shown via
  "Show removed" must NEVER add to the total).
- When no filters are active it reads as the all-time total of the visible scope
  (admin: whole mandal; volunteer: their own) — which also satisfies "show the
  total collection there".
- Accuracy caveat: the list itself is capped at 1000 rows (existing behavior). For
  the **unfiltered/all** total, compute from `getDonationsLite()` (uncapped) instead
  of the capped list so the strip never undercounts; day/search-filtered totals can
  come from the same lite array filtered identically. (List rendering stays capped —
  that's a separate, pre-existing pagination TODO; do not tackle it here.)

---

## 4. Strings (`src/lib/strings.ts`) — all new copy, English, i18n-ready

Under `ledger:`: `todaysCollectionLabel`, `dayCardTitle` ('Collection by day'),
`dayToday` ('Today'), `dayYesterday` ('Yesterday'), `dayPickLabel` ('Pick a date'),
`noCollectionsOnDay`, `byVolunteerTitle` ('By volunteer'), `byModeTitle` ('By payment mode').

Under `collections:`: `searchPlaceholder`, `dateFilterAll` ('All dates'),
`dateFilterToday` ('Today'), `dateFilterPick` ('Pick date'),
`totalPrefix` ('Total: '), `donationsSuffix` (' donations').

(Existing `collections.detailDate` TODO in the file is unrelated — leave it.)

---

## 5. Tests (Vitest + RTL, matching existing patterns)

- **`tests/dayFilter.test.ts`** (new, aim 100% like `money.ts`/`reconcile.ts`):
  - IST-boundary cases: ISO `2026-08-15T18:35:00Z` (= Aug 16, 00:05 IST) counts as
    Aug 16, not Aug 15; 11:55 PM IST donation counts as that local day.
  - `parseLocalDay('2026-08-16')` → local midnight (NOT `new Date('2026-08-16')` UTC parse).
  - `summarizeDay`: excludes voided; correct byMode & byVolunteer sums; empty day → zeros.
  - `totalsOf`: excludes voided; integer paise sums.
- **`tests/Collections.test.tsx`** (extend): search narrows by name/phone/receipt;
  date filter Today vs pick-date; totals bar shows filtered sum and ignores voided
  rows even when "Show removed" is on; filters compose.
- **`tests/MasterLedger.test.tsx`** (extend): today card shows today's non-voided sum;
  day card date change updates total + per-volunteer rows; empty-day state.
- Run the full gate before commit: `npm run typecheck && npm run test` (SPEC boundary).
  E2E specs are untouched by these read-only additions; run `npm run test:e2e` once at the end.

---

## 6. Migration & data-safety policy (LIVE PRODUCT — read carefully)

**Required schema changes: NONE.** Everything above is client-side filtering/aggregation
over queries that already pass RLS. Explicitly:

- ❌ No `ALTER TABLE`, no column changes, no new tables.
- ❌ No changes to RLS policies, `forbid_financial_edit()`, `void_row()`, receipt
  numbering, or any existing RPC (SPEC "Ask first / Never" boundaries stay intact).
- ❌ No `UPDATE`/`DELETE` of any existing row. No data backfill. Nothing touches
  live collection records.
- ✅ **Optional** (performance only, safe to skip at current scale) one additive migration:

  ```sql
  -- supabase/migrations/20260816120000_donations_created_at_idx.sql
  create index if not exists donations_mandal_created_at_idx
    on donations (mandal_id, created_at desc);
  ```

  Purely additive; `if not exists` makes it re-runnable; zero row changes. At today's
  data volume it's optional — include it only if `getDonationsLite()` feels slow.
  Apply with `supabase db push` as usual; nothing to roll back because nothing is altered.

If during implementation ANYTHING seems to require touching existing schema, RLS, or
data — **stop and ask first** (SPEC.md Boundaries).

---

## 7. Timezone rule (worth restating — it's the one real bug trap)

`created_at` is stored UTC. Every "which day is this?" decision must happen in the
**device's local timezone** (users are IST): use the `isOnLocalDay`/`parseLocalDay`
helpers everywhere; never slice `iso.substring(0, 10)`, never `new Date('yyyy-mm-dd')`
for a local day. The existing `shortTime()` in `Collections.tsx` already follows the
local-day convention — stay consistent with it.

---

## 8. Suggested commit sequence (small, verifiable steps)

1. `lib/dayFilter.ts` + `tests/dayFilter.test.ts` (pure logic, green first).
2. `getDonationsLite()` in `lib/db/donations.ts`.
3. Dashboard: today card + collection-by-day card (+ switch Source/Insight cards to lite) + strings + tests.
4. Collections: search + date filter + totals bar + strings + tests.
5. (Optional) index migration.
6. `npm run typecheck && npm run test && npm run test:e2e` → done.

## Out of scope (explicitly)

- Pagination / "load more" past 1000 rows in the Collections list (pre-existing TODO).
- Expense/day or handover/day filtering (this request is donations only).
- Date-range (from–to) filtering — single-day + today covers the stated need; the
  helpers are written so a range variant is a small follow-up if wanted.
