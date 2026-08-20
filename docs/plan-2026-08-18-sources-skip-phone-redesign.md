# Plan v2: Custom Sources · Skip Phone · Expense Categories on Expenses Tab · Emoji Removal · Mobile Redesign (2026-08-18)

> ⚠️ **LIVE PRODUCT.** Same rules as the 2026-08-16 plan: financial rows are append-only,
> nothing existing is ever UPDATEd/DELETEd, RLS and `forbid_financial_edit()` stay intact.
> This plan has ONE additive migration (§1); everything else is client-side.
>
> 🎨 **The design is the source of truth.** The user's Claude Design redesign is committed at
> **`docs/design/admin-dashboard-redesign.dc.html`** (fetched from their share link, 294KB).
> Structure of that file: lines ~12–2303 = the full static mockup of the mobile admin console
> (inline styles, exact colors/spacing); line ~2304 to end = the interactive `text/x-dc`
> script containing the full behavioral spec (state machine for tabs, sheets, filters,
> sources management, skip-phone flow). **Open and read both parts before building each
> screen — match it 1:1.** The design already encodes every feature in this plan.

---

## Verified state (what the previous plan shipped — confirmed in code)

`lib/dayFilter.ts` (+tests), uncapped paged `getDonationsLite()`, dashboard Today card +
Collection-by-day card, Collections search + date filter + totals strip. Build on top of this.

---

## Part 1 — Custom donation sources (replaces fixed Society/Shop/Other)

### The design's model (follow exactly)

- Sources are a per-mandal list, **default `['Society', 'Shop', 'Other']`**, **capped at 6
  slots** — the design shows an explanatory line when the cap is hit ("Six is the cap…").
- A "Manage sources" bottom sheet (design sheet id: `sources`): add, rename, remove.
- The collect form shows sources as a chip row; selection persists (existing
  `vm:lastCategory` localStorage pattern — keep, but store the source name).
- Display rule for rows (this is the append-only trick, straight from the design script):
  `d.srcName ?? SRC_LABEL[d.src]` — i.e. **new donations store the source name as text;
  legacy rows keep their `society`/`shop`/`other` slug and display via a fixed label map**
  {society→Society, shop→Shop, other→Other}. **Renaming or removing a source NEVER touches
  existing donation rows** — old rows keep showing the name they were recorded under.

### The one migration (additive; live-safe)

```sql
-- 20260818120000_custom_donation_sources.sql
-- 1) Per-mandal source list (mirrors expense_categories exactly)
alter table mandals
  add column donation_sources text[] not null default '{Society,Shop,Other}';

-- 2) Relax the fixed CHECK on donations.category so custom names fit.
--    Constraint-name note: confirm the auto-generated name first via
--    select conname from pg_constraint where conrelid='donations'::regclass and contype='c';
alter table donations drop constraint donations_category_check;
alter table donations add constraint donations_category_check
  check (length(btrim(category)) > 0 and length(category) <= 40);

-- 3) Read RPC so VOLUNTEERS see the list (mandals select is admin-only; mirror
--    the existing get_expense_categories() RPC verbatim, grant to authenticated)
create or replace function get_donation_sources() returns text[]
language sql stable security definer set search_path = public as $$
  select donation_sources from mandals where id = app_mandal_id()
$$;
revoke execute on function get_donation_sources() from public;
grant execute on function get_donation_sources() to authenticated;
```

Safety analysis (state this in the PR): dropping/re-adding a CHECK is metadata-only — no
table rewrite, no row changes; existing `society/shop/other` values satisfy the new check;
the column default `'society'` stays (harmless — the form always sends a value, and any
stale offline client that syncs an old-style row remains valid). `forbid_financial_edit()`
already blocks category edits on existing rows — **do not modify the trigger.**
Deploy order: migration first, then the client (old clients keep inserting the three
slugs — still valid under the new check).

### Code changes

- `lib/db/donations.ts`: `DonationCategory` becomes `string`; `CreateDonationInput.category: string`.
  Offline queue (`lib/queue/db.ts` Dexie row) already carries `category: string`? — verify;
  if typed to the union, widen it. **Dexie schema version bump is NOT needed for a type widen.**
- `lib/db/config.ts`: `getDonationSources()` via the RPC; update path reuses
  `updateMandal({ donation_sources })` (admin-only via existing `mandals_admin_update` RLS).
- New `lib/sources.ts` (pure, unit-tested): `LEGACY_SOURCE_LABELS` map, `sourceLabel(value)`,
  `canAddSource(list)` (cap 6), name validation (non-empty, ≤40 chars, no duplicates
  case-insensitive), and `sourceFilterOptions(mandalList, rowsValues)` = union of the
  mandal's list and every distinct value present in rows (so removed/renamed/legacy sources
  still filterable — a filter option must never disappear while rows carry it).
- `CollectionForm.tsx`: chip row from `getDonationSources()`; "Manage" affordance opens the
  sources sheet (volunteers: add only, via the `add_donation_source` RPC — see the decided
  Open Question 1; admins: full add/rename/remove); no hardcoded CATEGORY_OPTIONS.
- `lib/db/config.ts` also gets `addDonationSource(name)` calling the RPC (all roles).
- `Collections.tsx` source filter + `MasterLedger.tsx` SourceCard: options/labels via
  `sourceFilterOptions`/`sourceLabel`; SourceCard buckets by actual values (rank-ordered,
  reuse the CATEGORY_COLORS slot pattern) instead of the hardcoded three rows.
- Strings: all new copy in `strings.ts` (manageSources, addSource, renameSource,
  removeSource, sourceCapHint, duplicateSourceError, …).
- Tests: `lib/sources.test.ts` exhaustive; component tests for chip row from RPC,
  cap behavior, legacy-slug display, filter options union.

---

## Part 2 — Skip phone number ("record without receipt")

Validation already allows an empty phone (audit 2026-07-18 #8) — what's missing is the
explicit UX and keeping skipped donations out of the Pending-send tray forever.

Follow the design's flow exactly (in the x-dc script):

- A "Donor didn't share a number" toggle on the collect form (`cSkip` in the design).
  When on: phone input hidden/disabled, helper text "skipped", submit button label
  becomes **"Record without receipt"** (vs "Record donation").
- Enablement rule from the design: `name + amount valid && (skip || valid phone)`.
- A skipped donation must NOT enter the pending tray: in
  `getPendingSendDonations()` add `.not('donor_phone', 'is', null)` — today a phone-less
  donation sits in Pending forever with no send buttons (audit #4 only fixed the buttons).
- Post-save card: for phone-less donations show a "recorded — no receipt to send" state
  (the `noPhoneHint` string already exists) instead of SMS/WhatsApp buttons.
- No DB change: `donor_phone` is already nullable and inserts already send null for ''.
- Tests: validation (skip on → no phone error; skip off + bad phone → error), pending
  tray excludes phone-less rows, form toggle resets after save.

---

## Part 3 — Expense categories move to the Expenses tab

- Management UI (add/remove chips — the exact UI now in `MandalConfig.tsx` ~lines 116–280,
  `categoriesLabel` section) moves into `ExpensesScreen.tsx`, admin-only (gate on
  `isAdminRole`; volunteers just see the category select as today). Persist via the same
  `updateMandal({ expense_categories })` — RLS already restricts writes to admins.
- Remove the categories section from Settings (keep everything else there). One editing
  surface, not two — avoids two screens fighting over the same array.
- Same append-only rule: removing a category never touches past expenses; the expense list
  filter (design sheet `efilters`) derives options from union(list, values in rows).
- Design reference: expense form is sheet `expform`, category management lives right there.
- Tests: admin sees manage UI / volunteer doesn't; category still saved with expense;
  historical expense with a removed category still renders and filters.

---

## Part 4 — Remove ALL emojis (replace per the design: text, not icons)

The design uses **zero emoji and zero icon fonts** — modes are uppercase text chips
("CASH" / "UPI" / "BANK"), sources are plain name chips, people are letter avatars,
actions are text buttons. Replace accordingly; minimal inline SVG is acceptable only where
the design shows a glyph (e.g. the ✓ in the Balanced chip — a styled character is fine).

Full inventory to purge (verified by scan — after removal, add a lint/CI grep to keep them out):

- `features/admin/AdminLayout.tsx`: 🪔 📊 🧾 👥 💸 🤝(×2) 💰 🧑(×2) 🪷 ⚙ (nav icons → design's text tabs)
- `features/collection/CollectionForm.tsx`: 💵 📱 🏦 🏠 🏪 🪔 (mode + category chips → text chips)
- `features/collection/Collections.tsx`: 💵 📱 🏦 🏠 🏪 🪔 💰 📞 💬 (row icons → design's row layout; Call/WhatsApp become text buttons)
- `lib/strings.ts`: 🙏(×2) 📲 🧾 📊 ⚖ 🪷 🏛 (inside receipt/landing copy — check each; the
  SMS receipt message 🙏 is donor-facing copy, replace with plain text)
- `MasterLedger.tsx` / `reconcile.ts`: ✓ ✗ stay (typographic marks the design keeps).
- Also check `PendingSend.tsx`, `ReceiptPage.tsx`, `LandingPage.tsx`, `DemoPhone.tsx` for
  the same set — the scan covered `src/` but re-grep after the redesign lands.

---

## Part 5 — Implement the mobile redesign (docs/design/admin-dashboard-redesign.dc.html)

**Read the design file first. Match it, don't approximate it.** Key facts extracted:

- **Design tokens:** bg `#FAFAF9`, deep-ink hero `#100C08`, accent `#EA580C` (hover
  `#C2410C`), selected-chip bg `#FFF7ED`, borders `#E7E5E4`, muted text `#57534E`/`#44403C`;
  fonts **Hanken Grotesk** (UI), **Bricolage Grotesque** (display), Marcellus + Spectral
  (accents); 16px radius chips/cards, 86px-tall mode tiles, bottom sheets with
  `sheetUp`/`dimIn`/`fadeUp` animations. Add fonts + keyframes globally; map colors to
  Tailwind theme tokens (no inline hex in components — SPEC code style).
- **IA:** ONE mobile console, header "DIGITAL VARGANI · CONSOLE / Dashboard" + Menu, with
  pill tabs: `overview · collections · expenses · cash · members · report · settings`
  (tab ids straight from the design script; Collections tab hosts both `donations` and
  `donors` views — the current separate Donors page merges in; Pending sends surfaces as a
  row/entry inside the relevant tab per the design, not a separate destination).
- **Overview tab** = dark Net-Balance hero (₹ total, "Balanced" chip, collected/spent
  bars), "Cash with volunteers" card with settled-volunteers collapse ("2 volunteers
  settled up · show"), "Collection by day" card. This maps 1:1 onto the data the dashboard
  already fetches (ledger, dayFilter summaries) — presentation changes only.
- **Bottom sheets** (all in the x-dc script; reuse/extend `components/Sheet.tsx`):
  `filters`, `efilters`, `detail` (donation, with the phone/receipt actions), `donor`,
  `expform`, `hdetail`/`invdetail` (handover/invite), `invite`, `member`, `more` (menu:
  Pending sends, Switch mandal, Incl. removed/voided…), `picker` (date), `recon`
  (books-balance explainer), `settle` (handover), `sources`, `cleanup` (danger zone),
  `howto`.
- **Filters in the design** match what's already built (mode, source, incl. removed,
  day/date, sort by amount/name, search) — wire the new UI to the existing state logic;
  do not re-derive business logic from the mockup.
- **Routing:** keep URLs stable (`/admin`, `/admin/collections`, …) — the tab bar is a
  presentation change; deep links and RequireRole guards must keep working. The volunteer
  `/collect` flow gets the same visual language (form chips, sheets) but keeps its own
  shell + tab bar.

### Build order (each step: typecheck + tests green before the next)

1. Foundations: fonts, Tailwind tokens, keyframes, upgraded Sheet, chip/tile/hero
   primitives. (Parts 1–4 can land before or interleaved — they're semantic, not visual.)
2. AdminLayout → console shell (header, pill tabs, Menu sheet).
3. Overview tab (hero, cash-with-volunteers + settled collapse, collection-by-day).
4. Collections & donors tab (list rows per design, detail sheet, filters sheet, donors view).
5. Expenses tab (list, expform sheet, category management from Part 3, efilters).
6. Cash tab (cash-in-hand + settle sheet), Members tab (invite/member sheets).
7. Report + Settings tabs.
8. Volunteer collect flow reskin (form chips, skip-phone toggle, sources sheet).
9. Emoji purge sweep (Part 4) + Playwright selector updates + full e2e run.

---

## Boundaries & safety recap

- Only migration: §1 (column add + CHECK swap + read RPC). Nothing else touches the DB.
- Never UPDATE/DELETE existing donations/expenses/handovers. Renames/removals of
  sources/categories are list-edits on `mandals` only.
- Don't touch: `forbid_financial_edit()`, `void_row()`, receipt numbering, RLS policies,
  reconciliation identity, offline sync engine semantics.
- `npm run typecheck && npm run test` before every commit; `npm run test:e2e` after
  steps 2, 8, 9.

## Open questions (safe defaults chosen; flip if the user says so)

1. **Who can edit donation sources? — DECIDED (user, 2026-08-18): volunteers can ADD;
   rename/remove stays admin-only.** Implement adds via an `add_donation_source(p_name text)`
   SECURITY DEFINER RPC (grant to authenticated) that: verifies the caller is an active
   member of the mandal (`app_mandal_id()` scope), trims/validates the name (non-empty,
   ≤40 chars, case-insensitive duplicate check against the existing array), enforces the
   6-slot cap, and appends to `mandals.donation_sources`. Do NOT widen `mandals` UPDATE
   RLS — the RPC is the only volunteer write path. Rename/remove keep using
   `updateMandal` (admin-only RLS). UI: volunteers get an "Add source" affordance in the
   sources sheet (no rename/delete controls); admins get the full Manage sheet.
   Tests: volunteer can add (cap + duplicate rejected), volunteer cannot rename/remove,
   other-mandal caller gets an error.
2. Expense categories: fully removed from Settings (chosen) vs shown read-only there.
3. The design shows "Switch mandal" in the Menu sheet — multi-mandal membership is not in
   the current auth model; treat as future/ignore unless asked.
