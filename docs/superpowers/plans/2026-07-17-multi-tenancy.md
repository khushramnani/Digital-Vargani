# Multi-Tenancy, Mandal Onboarding & Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the hard-wired single-mandal app into many independent mandals, each with self-serve signup, its own team, its own books, and its own gapless receipt numbers — with no mandal able to see another's data.

**Architecture:** One tenant key, `users.mandal_id`, read through a single `app_mandal_id()` helper that every RLS policy and every SECURITY DEFINER RPC consults. `mandal_config` (a boolean-PK singleton) becomes `mandals` (real UUID PK + slug + receipt counter). `mandal_id` is stamped server-side by the existing insert trigger — never accepted from the client — which is why almost every screen needs no change. Receipt numbers move from one global sequence to a per-mandal counter column incremented under a row lock.

**Tech Stack:** Postgres 15 (Supabase), SQL migrations, React 18 + TypeScript, Vite, Tailwind, Supabase JS client, Vitest + React Testing Library, Playwright, bash + psql (`supabase/verify-local.sh`).

**Spec:** `docs/superpowers/specs/2026-07-17-multi-tenancy-design.md`

## STATUS: COMPLETE — all tasks done, all gates green

Every task (1–10) is implemented, verified, and committed; the migrations are applied to the
live project. Final sweep: `verify-local.sh` PASS · `typecheck` 0 errors · `lint` clean ·
`test` 180/180 across 24 files with `money.ts`/`reconcile.ts` at 100% · `test:e2e` 9/9.

Changes forced during execution that this plan did not predict (the plan text below is left
as written; where it disagrees with the repo, **the repo is right**):

- `enforce_insert_defaults()` stamps `coalesce(app_mandal_id(), new.mandal_id)`, not a bare
  `app_mandal_id()` — a bare stamp raised on any session-less insert.
- `create_mandal` takes a third arg, `slug_hint`, and clamps slugs to the constraint's real
  2–40 bounds (`20260717160000`). A mandal named `A`, and two mandals sharing a 40+ char name,
  both raised a raw `check_violation` before that.
- `mandal_id` needed `default app_mandal_id()` on all four tables (`20260717130000`), and
  `receipt_no` needed its default restored (`20260717140000`) — without them the generated
  Insert types demanded the very values the client must never send. For `users` it was
  load-bearing: that table has no insert trigger, so invites had no mandal at all.
- A published demo mandal (slug `demo`, `20260717150000`) exists because Task 7 silently broke
  the landing page's "See a sample report →" CTA into a blank page.
- 9 test files broke, not the 5 listed; `MandalConfig.tsx` and 5 insert call sites needed
  changes the spec claimed were unnecessary.
- `verify-local.sh` had never passed (missing `extensions` schema stub) and the e2e suite had
  been red and aimed at the live project (`.env.local` drift vs. hardcoded stub origins). Both
  fixed; neither was caused by this work.

## Original status note: Tasks 1–4 (dry-run complete, committed)

The SQL landed in `supabase/migrations/20260717120000_multi_tenancy.sql` and
`bash supabase/verify-local.sh` exits 0 with every tenant-isolation assertion passing.
**Start at Task 5.** What changed from this plan during the dry run:

1. **`enforce_insert_defaults()` stamps `coalesce(app_mandal_id(), new.mandal_id)`**, not a bare
   `app_mandal_id()`. A bare stamp raised on any session-less insert, breaking table-owner
   seeding. A real session still always wins (forgery override is asserted), and RLS rejects a
   non-member caller before the fallback matters.
2. **`create_mandal(mandal_name, admin_name, slug_hint text default null)`** — a third,
   optional argument. `slugify()` is ASCII-only, so a Devanagari-named mandal fell back to
   `mandal`/`mandal-2`/`mandal-3`, defeating the slug's purpose. The hint is slugified and
   uniqueness-checked, never trusted raw. **Task 6 must add this field to the signup form.**
3. **`verify-local.sh` was broken before this work began** and has been fixed separately: it
   never stubbed the `extensions` schema that `extensions.gen_random_bytes()` needs, so it had
   never run green. It now also loops over `migrations/*.sql` rather than listing each file.
4. The live project has **not** been migrated yet — see Task 5 Step 1.

## Global Constraints

- TypeScript strict. Run `npm run typecheck` and `npm run test -- --run` after every task, before committing.
- All user-facing copy goes through `src/lib/strings.ts` — no inline text in JSX.
- **`mandal_id` is never accepted from the client.** It is stamped in `enforce_insert_defaults()` from `app_mandal_id()`, exactly as `receipt_no`/`public_token` already are. Any task that adds an insert path must not add a `mandal_id` field to the payload.
- **Every new RLS policy is scoped by `app_mandal_id()`.** Every new SECURITY DEFINER function that takes a mandal identifier must check `app_mandal_id()` before returning non-public data.
- **Every new function gets `revoke execute on function … from public;` before its `grant`.** Postgres grants EXECUTE to PUBLIC on creation; the `list_admins()` migration already caught this once.
- No hard deletes. No `delete` policy is added anywhere.
- Money is not touched: `src/lib/money.ts` and `src/lib/reconcile.ts` must not change, and must stay at 100% coverage (enforced by `vite.config.ts` thresholds).
- No new npm dependency in this plan.
- `verify-local.sh` must exit 0 after every task that touches SQL. It needs no Docker: `bash supabase/verify-local.sh`.
- This machine has **no Docker**, so `supabase start` / `supabase db reset` are unavailable. `verify-local.sh` is the only way to execute the SQL locally.

## File Structure

**Created:**
- `supabase/migrations/20260717120000_multi_tenancy.sql` — the entire schema change, in one migration. It is not splittable: the backfill must run between "add nullable column" and "set not null", and a half-applied tenancy schema is a data leak.
- `src/features/auth/Signup.tsx` — the create-your-mandal screen.
- `src/lib/db/mandals.ts` — `createMandal()` RPC wrapper. Separate from `config.ts` because it is the only pre-membership call in the app (it runs when the caller has no `users` row yet), while everything in `config.ts` assumes a resolved mandal.

**Modified:**
- `supabase/seed.sql` — two mandals instead of one config row.
- `supabase/verify-local.sh` — migration loop + tenant-isolation assertions.
- `src/lib/db/config.ts`, `receipt.ts`, `transparency.ts`, `ledger.ts` — table rename + RPC signatures.
- `src/features/auth/AuthProvider.tsx`, `src/app/router.tsx` — "authed but no mandal" → `/signup`.
- `src/features/transparency/PublicTransparency.tsx`, `AdminTransparency.tsx` — slug-addressed.
- `src/features/receipt/ReceiptPage.tsx` — branding folded into the receipt RPC.
- `src/features/landing/LandingPage.tsx` — CTA to `/signup`.
- `src/lib/strings.ts` — signup copy.
- `tests/config.test.ts`, `MandalConfig.test.tsx`, `AdminTransparency.test.tsx`, `receipt.test.ts`, `ReceiptPage.test.tsx` — reference removed types; break at typecheck.

**Task order rationale:** SQL lands first (Tasks 1–4) and is proven by `verify-local.sh` before a single line of TypeScript moves. The client cannot compile against the new schema until `db:types` regenerates, which cannot happen until the migration is correct.

---

### Task 1: The migration — `mandals` table, slug, backfill

**Files:**
- Create: `supabase/migrations/20260717120000_multi_tenancy.sql`
- Modify: `supabase/verify-local.sh:31-41` (migration file list → loop), `supabase/verify-local.sh:78-88` (auth stub)

**Interfaces:**
- Consumes: existing `mandal_config`, `users`, `donations`, `expenses`, `handovers` from `20260714111950_schema_and_rls.sql`.
- Produces: table `mandals(id uuid, name text, slug text, logo_url, signature_url, upi_vpa, upi_qr_url, receipt_prefix, expense_categories, bank_opening_paise, transparency_published, next_receipt_no, created_at)`; `slugify(txt text) returns text`; `mandal_id uuid not null` on `users`/`donations`/`expenses`/`handovers`. `mandal_config` and `public_mandal_branding` no longer exist after this task.

- [ ] **Step 1: Make `verify-local.sh` loop over migrations instead of listing them**

The script hardcodes `MIGRATION_FILE` … `MIGRATION_FILE_9` and applies them one by one. This plan adds a 10th, and every future migration would add another variable. Replace the list with a loop.

In `supabase/verify-local.sh`, delete these lines:

```bash
MIGRATION_FILE="$SCRIPT_DIR/migrations/20260714111950_schema_and_rls.sql"
MIGRATION_FILE_2="$SCRIPT_DIR/migrations/20260714121305_add_users_email.sql"
MIGRATION_FILE_3="$SCRIPT_DIR/migrations/20260714124014_redeem_invite.sql"
MIGRATION_FILE_4="$SCRIPT_DIR/migrations/20260714131940_mandal_assets_storage.sql"
MIGRATION_FILE_5="$SCRIPT_DIR/migrations/20260714134206_donations_sms_sent.sql"
MIGRATION_FILE_6="$SCRIPT_DIR/migrations/20260714140000_donations_idempotency_key.sql"
MIGRATION_FILE_7="$SCRIPT_DIR/migrations/20260714150000_list_admins.sql"
MIGRATION_FILE_8="$SCRIPT_DIR/migrations/20260714160000_transparency_report.sql"
MIGRATION_FILE_9="$SCRIPT_DIR/migrations/20260714170000_expense_categories_rpc.sql"
```

Then delete each of the nine `echo "== applying migration … =="` / `"${PSQL[@]}" -d "$DB_NAME" -f "$MIGRATION_FILE_N"` pairs **and** the `echo "== stubbing storage schema (Task 6) =="` block that sits between migrations 3 and 4 — the storage stub gets moved earlier in Step 2, since it depends on nothing.

Replace all of it, at the point where the first migration used to be applied, with:

```bash
echo "== applying migrations (in filename order) =="
for migration in "$SCRIPT_DIR"/migrations/*.sql; do
  echo "   -> $(basename "$migration")"
  "${PSQL[@]}" -d "$DB_NAME" -f "$migration"
done
```

- [ ] **Step 2: Move the storage stub up and add `auth.jwt()` to the auth stub**

The storage stub must now run before the loop (it previously sat between migrations 3 and 4). It depends on nothing, so it is safe to hoist.

In `supabase/verify-local.sh`, replace the `echo "== stubbing auth schema =="` block's SQL heredoc with this — it adds `auth.jwt()`, which `create_mandal()` needs in Task 3 and which does not exist in the current stub:

```bash
echo "== stubbing auth + storage schemas =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase exposes the whole JWT payload as auth.jwt(); create_mandal()
-- reads its is_anonymous claim to reject volunteer (signInAnonymously)
-- sessions. The real thing returns the decoded token; this stub returns
-- whatever request.jwt.claims is set to, which is enough to exercise the
-- guard from both sides.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create role anon;
create role authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Task 1 of the multi-tenancy plan scopes the mandal-assets storage
-- policies by folder prefix, which needs Supabase's path helper.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/')
$$;
SQL
```

- [ ] **Step 3: Run the script to confirm the refactor is still green before changing any schema**

Run: `bash supabase/verify-local.sh`
Expected: `PASS: all migration/trigger/RLS assertions held.` and exit 0. If this fails, the loop/stub refactor is wrong — fix it before writing the migration, so Task 1's real failure signal isn't masked.

- [ ] **Step 4: Write the migration — `slugify()` and the `mandals` table**

Create `supabase/migrations/20260717120000_multi_tenancy.sql`:

```sql
-- Multi-tenancy: mandal_config (a boolean-PK singleton) becomes mandals, and
-- every table gains a mandal_id tenant key. See
-- docs/superpowers/specs/2026-07-17-multi-tenancy-design.md.
--
-- Ordering is load-bearing: copy mandal_config's row into mandals BEFORE
-- adding NOT NULL columns that reference it, and backfill next_receipt_no
-- from max(receipt_no) BEFORE dropping the global sequence. A half-applied
-- version of this file is a cross-tenant data leak, so it is one migration.

-- Slug for the public transparency URL. Mandals paste that link into
-- WhatsApp groups; a raw UUID reads as a phishing link to a donor.
create or replace function slugify(txt text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(txt), '[^a-z0-9]+', '-', 'g'))
$$;

create table mandals (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  logo_url               text,
  signature_url          text,
  upi_vpa                text,
  upi_qr_url             text,
  receipt_prefix         text not null default 'VM',
  expense_categories     text[] not null default '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}',
  bank_opening_paise     bigint not null default 0,
  transparency_published boolean not null default false,
  next_receipt_no        bigint not null default 1,
  created_at             timestamptz not null default now()
);

-- Copy the existing single config row across. A mandal named entirely in
-- Devanagari (गणेश मंडळ) slugifies to '' and would fail the check
-- constraint — that is the target market, not an exotic edge case, so the
-- fallback is required here exactly as it is in create_mandal().
insert into mandals (
  name, slug, logo_url, signature_url, upi_vpa, upi_qr_url,
  receipt_prefix, expense_categories, bank_opening_paise, transparency_published
)
select
  name,
  coalesce(nullif(slugify(name), ''), 'mandal'),
  logo_url, signature_url, upi_vpa, upi_qr_url,
  receipt_prefix, expense_categories, bank_opening_paise, transparency_published
from mandal_config;
```

- [ ] **Step 5: Add the backfill to the same migration**

Append to `supabase/migrations/20260717120000_multi_tenancy.sql`:

```sql
-- ── Tenant key backfill ────────────────────────────────────────────────
-- Nullable first, backfill, then NOT NULL. At this point exactly one mandal
-- exists (or zero, on a fresh database), so the unqualified subquery is
-- unambiguous. On a fresh database every UPDATE matches zero rows and the
-- SET NOT NULL succeeds trivially on empty tables — both paths must work.

alter table users      add column mandal_id uuid references mandals(id);
alter table donations  add column mandal_id uuid references mandals(id);
alter table expenses   add column mandal_id uuid references mandals(id);
alter table handovers  add column mandal_id uuid references mandals(id);

update users     set mandal_id = (select id from mandals limit 1);
update donations set mandal_id = (select id from mandals limit 1);
update expenses  set mandal_id = (select id from mandals limit 1);
update handovers set mandal_id = (select id from mandals limit 1);

alter table users      alter column mandal_id set not null;
alter table donations  alter column mandal_id set not null;
alter table expenses   alter column mandal_id set not null;
alter table handovers  alter column mandal_id set not null;

-- ── Receipt numbers: global sequence -> per-mandal counter ─────────────
-- Existing receipt numbers must not be reissued, so the counter starts
-- above the highest number already handed out.
update mandals set next_receipt_no = coalesce((select max(receipt_no) + 1 from donations), 1);

alter table donations alter column receipt_no drop default;
drop sequence receipt_no_seq;

-- Receipt numbers are only unique WITHIN a mandal now — two mandals both
-- having receipt #1 is the correct behaviour, not a collision.
alter table donations drop constraint donations_receipt_no_key;
alter table donations add constraint donations_mandal_receipt_no_key unique (mandal_id, receipt_no);

create index users_mandal_id_idx     on users(mandal_id);
create index donations_mandal_id_idx on donations(mandal_id, created_at desc);
create index expenses_mandal_id_idx  on expenses(mandal_id);
create index handovers_mandal_id_idx on handovers(mandal_id);
```

- [ ] **Step 6: Run the script — expect a specific, informative failure**

Run: `bash supabase/verify-local.sh`
Expected: FAIL. The migration applies, but existing assertions and `seed.sql` still reference `mandal_config`, and the policies/trigger still reference the old world. The error should be about `mandal_config` or a missing policy — **not** a syntax error in the new migration. If it is a syntax error, fix that now; the remaining failures are addressed in Tasks 2–4 and Task 5.

Do not commit yet — the tree is intentionally broken until Task 4.

---

### Task 2: RLS rewrite + server-side `mandal_id` stamping

**Files:**
- Modify: `supabase/migrations/20260717120000_multi_tenancy.sql` (append)

**Interfaces:**
- Consumes: `mandals`, `mandal_id` columns from Task 1.
- Produces: `app_mandal_id() returns uuid`; re-published `enforce_insert_defaults()` and `forbid_financial_edit()`; mandal-scoped policies on `mandals`/`users`/`donations`/`expenses`/`handovers`/`storage.objects`.

- [ ] **Step 1: Add the tenant-key helper**

Append to `supabase/migrations/20260717120000_multi_tenancy.sql`:

```sql
-- ── The tenant key ─────────────────────────────────────────────────────
-- Mirrors app_user_id()/app_user_role() from the base migration. Every
-- policy and every mandal-scoped RPC reads the caller's mandal through
-- this one function — one place to reason about, one place to get wrong.
create or replace function app_mandal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select mandal_id from users where auth_user_id = auth.uid()
$$;
```

- [ ] **Step 2: Stamp `mandal_id` server-side and allocate per-mandal receipt numbers**

Append to the migration. This re-publishes `enforce_insert_defaults()` — the existing triggers reference it by name and pick up the new body automatically.

```sql
-- ── Insert-time stamping ───────────────────────────────────────────────
-- SECURITY DEFINER is required, for two reasons:
--   1. mandal_id is stamped from the session, never from the client — the
--      same rule collected_by already follows. A compromised client cannot
--      write into another mandal's books no matter what it sends.
--   2. Receipt allocation updates `mandals`, and volunteers have no update
--      policy on that table (and must not get one).
--
-- The `update … returning` takes a row lock on the mandal, so two
-- volunteers inserting concurrently serialize on it and get distinct,
-- gapless numbers. Different mandals lock different rows and never contend.
create or replace function enforce_insert_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mandal_id := app_mandal_id();

  if new.mandal_id is null then
    raise exception 'no mandal for the current session';
  end if;

  if TG_TABLE_NAME = 'donations' then
    update mandals
       set next_receipt_no = next_receipt_no + 1
     where id = new.mandal_id
    returning next_receipt_no - 1 into new.receipt_no;

    new.public_token := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  new.voided := false;
  new.void_reason := null;
  new.voided_by := null;
  new.voided_at := null;
  return new;
end;
$$;
```

- [ ] **Step 3: Add `mandal_id` to the append-only guard**

Append to the migration. Re-publishes `forbid_financial_edit()` in full (the function is referenced by name from three triggers); the only change is a `mandal_id` clause on each branch.

```sql
-- Re-published with one new guard per branch: mandal_id is a financial
-- field for append-only purposes — moving a donation between mandals would
-- silently rewrite both mandals' books.
create or replace function forbid_financial_edit() returns trigger
language plpgsql as $$
begin
  if TG_TABLE_NAME = 'donations' then
    if new.donor_name <> old.donor_name
       or new.donor_phone is distinct from old.donor_phone
       or new.amount_paise <> old.amount_paise
       or new.mode <> old.mode
       or new.collected_by <> old.collected_by
       or new.receipt_no <> old.receipt_no
       or new.public_token <> old.public_token
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id
       or new.client_idempotency_key is distinct from old.client_idempotency_key then
      raise exception 'donations rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    if new.category <> old.category
       or new.amount_paise <> old.amount_paise
       or new.description is distinct from old.description
       or new.paid_by <> old.paid_by
       or new.paid_from <> old.paid_from
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id then
      raise exception 'expenses rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'handovers' then
    if new.volunteer_id <> old.volunteer_id
       or new.amount_paise <> old.amount_paise
       or new.received_by <> old.received_by
       or new.note is distinct from old.note
       or new.created_at <> old.created_at
       or new.mandal_id <> old.mandal_id then
      raise exception 'handovers rows are append-only; void and re-enter instead of editing';
    end if;
  end if;
  return new;
end;
$$;
```

- [ ] **Step 4: Replace the `mandal_config` policies with mandal-scoped `mandals` policies**

Append to the migration:

```sql
-- ── RLS: mandals ───────────────────────────────────────────────────────
-- No INSERT policy: mandals are created only through create_mandal()
-- (SECURITY DEFINER, Task 3). No DELETE policy anywhere, same as every
-- other table.
alter table mandals enable row level security;

create policy mandals_admin_select on mandals for select
  using (is_admin() and id = app_mandal_id());
create policy mandals_admin_update on mandals for update
  using (is_admin() and id = app_mandal_id())
  with check (is_admin() and id = app_mandal_id());
```

- [ ] **Step 5: Re-scope every existing policy by mandal**

Append to the migration:

```sql
-- ── RLS: every table gains a mandal predicate ──────────────────────────
-- The volunteer policies are already transitively tenant-safe (a
-- volunteer's own rows are by definition in their own mandal). The mandal
-- predicate goes on anyway: transitive safety holds only until someone
-- edits a policy, and this is the file where a mistake leaks a donor list.

drop policy users_admin_select on users;
drop policy users_admin_insert on users;
drop policy users_admin_update on users;
create policy users_admin_select on users for select
  using (is_admin() and mandal_id = app_mandal_id());
create policy users_admin_insert on users for insert
  with check (is_admin() and mandal_id = app_mandal_id());
create policy users_admin_update on users for update
  using (is_admin() and mandal_id = app_mandal_id())
  with check (is_admin() and mandal_id = app_mandal_id());
-- users_self_select is deliberately untouched: it matches exactly one row
-- (the caller's own) and is what bootstraps app_mandal_id() in the first
-- place. Scoping it by app_mandal_id() would be circular.

drop policy donations_admin_select on donations;
drop policy donations_admin_insert on donations;
drop policy donations_admin_update on donations;
create policy donations_admin_select on donations for select
  using (is_admin() and mandal_id = app_mandal_id());
create policy donations_admin_insert on donations for insert
  with check (is_admin() and mandal_id = app_mandal_id());
create policy donations_admin_update on donations for update
  using (is_admin() and mandal_id = app_mandal_id())
  with check (is_admin() and mandal_id = app_mandal_id());

drop policy donations_volunteer_select on donations;
drop policy donations_volunteer_insert on donations;
drop policy donations_volunteer_update on donations;
create policy donations_volunteer_select on donations for select
  using (collected_by = app_user_id() and mandal_id = app_mandal_id());
create policy donations_volunteer_insert on donations for insert
  with check (collected_by = app_user_id() and mandal_id = app_mandal_id());
create policy donations_volunteer_update on donations for update
  using (collected_by = app_user_id() and mandal_id = app_mandal_id())
  with check (collected_by = app_user_id() and mandal_id = app_mandal_id());

drop policy expenses_admin_select on expenses;
drop policy expenses_admin_insert on expenses;
drop policy expenses_admin_update on expenses;
create policy expenses_admin_select on expenses for select
  using (is_admin() and mandal_id = app_mandal_id());
create policy expenses_admin_insert on expenses for insert
  with check (is_admin() and mandal_id = app_mandal_id());
create policy expenses_admin_update on expenses for update
  using (is_admin() and mandal_id = app_mandal_id())
  with check (is_admin() and mandal_id = app_mandal_id());

drop policy expenses_volunteer_select on expenses;
drop policy expenses_volunteer_insert on expenses;
drop policy expenses_volunteer_update on expenses;
create policy expenses_volunteer_select on expenses for select
  using (paid_by = app_user_id() and mandal_id = app_mandal_id());
create policy expenses_volunteer_insert on expenses for insert
  with check (paid_by = app_user_id() and mandal_id = app_mandal_id());
create policy expenses_volunteer_update on expenses for update
  using (paid_by = app_user_id() and mandal_id = app_mandal_id())
  with check (paid_by = app_user_id() and mandal_id = app_mandal_id());

drop policy handovers_admin_select on handovers;
drop policy handovers_admin_insert on handovers;
drop policy handovers_admin_update on handovers;
create policy handovers_admin_select on handovers for select
  using (is_admin() and mandal_id = app_mandal_id());
create policy handovers_admin_insert on handovers for insert
  with check (is_admin() and mandal_id = app_mandal_id());
create policy handovers_admin_update on handovers for update
  using (is_admin() and mandal_id = app_mandal_id())
  with check (is_admin() and mandal_id = app_mandal_id());

drop policy handovers_volunteer_select on handovers;
drop policy handovers_volunteer_insert on handovers;
drop policy handovers_volunteer_update on handovers;
create policy handovers_volunteer_select on handovers for select
  using (volunteer_id = app_user_id() and mandal_id = app_mandal_id());
create policy handovers_volunteer_insert on handovers for insert
  with check (volunteer_id = app_user_id() and mandal_id = app_mandal_id());
create policy handovers_volunteer_update on handovers for update
  using (volunteer_id = app_user_id() and mandal_id = app_mandal_id())
  with check (volunteer_id = app_user_id() and mandal_id = app_mandal_id());
```

- [ ] **Step 6: Scope the storage policies by mandal folder**

Append to the migration:

```sql
-- ── Storage: scope writes to the caller's own mandal folder ────────────
-- The existing policies check only is_admin(), which after this migration
-- would let any mandal's admin overwrite another mandal's logo by path.
-- Project B moves uploads to Cloudinary, but A must not ship that window.
drop policy mandal_assets_admin_write on storage.objects;
drop policy mandal_assets_admin_update on storage.objects;

create policy mandal_assets_admin_write on storage.objects
  for insert with check (
    bucket_id = 'mandal-assets'
    and is_admin()
    and (storage.foldername(name))[1] = app_mandal_id()::text
  );
create policy mandal_assets_admin_update on storage.objects
  for update using (
    bucket_id = 'mandal-assets'
    and is_admin()
    and (storage.foldername(name))[1] = app_mandal_id()::text
  ) with check (
    bucket_id = 'mandal-assets'
    and is_admin()
    and (storage.foldername(name))[1] = app_mandal_id()::text
  );
-- mandal_assets_public_read stays as-is: these images are exactly what the
-- public receipt page renders.
```

- [ ] **Step 7: Run the script**

Run: `bash supabase/verify-local.sh`
Expected: still FAIL, now on `seed.sql` / the old assertions referencing `mandal_config` — the RPCs are not yet rewritten (Task 3) and the seed is not yet updated (Task 4). Confirm the failure has moved past the policy DDL: no `policy … does not exist` or `column mandal_id does not exist` errors. Those would mean this task is wrong.

Do not commit yet.

---

### Task 3: RPCs — `create_mandal`, and closing the four cross-tenant leaks

**Files:**
- Modify: `supabase/migrations/20260717120000_multi_tenancy.sql` (append)

**Interfaces:**
- Consumes: `app_mandal_id()` from Task 2, `slugify()` + `mandals` from Task 1.
- Produces: `create_mandal(mandal_name text, admin_name text, slug_hint text default null) returns uuid` — **three args as shipped**, not the two this task's Steps 4–5 below were originally written against; see the STATUS header. Also re-published `list_admins()`, `get_expense_categories()`, `get_public_receipt(token text)`, `get_transparency_report(mandal_slug text)`, `get_transparency_categories(mandal_slug text)`. `link_admin_account()` and `redeem_invite(token)` are deliberately unchanged.

- [ ] **Step 1: Drop the cross-tenant branding view and fold branding into the receipt RPC**

Append to the migration:

```sql
-- ── Public receipt: branding comes from the receipt's own mandal ───────
-- public_mandal_branding was a view over "the one row" — with many mandals
-- it hands every mandal's branding to anon. Drop it. The receipt token is
-- unguessable and already scopes to exactly one row, so returning that
-- row's mandal branding alongside it is safe by construction, and drops the
-- receipt page from two round trips to one.
drop view public_mandal_branding;

drop function get_public_receipt(text);
create or replace function get_public_receipt(token text)
returns table (
  receipt_no        bigint,
  donor_name        text,
  amount_paise      bigint,
  mode              text,
  created_at        timestamptz,
  voided            boolean,
  void_reason       text,
  mandal_name       text,
  logo_url          text,
  signature_url     text,
  receipt_prefix    text
)
language sql stable security definer set search_path = public as $$
  select d.receipt_no, d.donor_name, d.amount_paise, d.mode, d.created_at,
         d.voided, d.void_reason,
         m.name, m.logo_url, m.signature_url, m.receipt_prefix
  from donations d
  join mandals m on m.id = d.mandal_id
  where d.public_token = token
  limit 1
$$;

revoke execute on function get_public_receipt(text) from public;
grant execute on function get_public_receipt(text) to anon, authenticated;
```

- [ ] **Step 2: Close the `list_admins()` and `get_expense_categories()` leaks**

Append to the migration:

```sql
-- ── list_admins: was returning every mandal's admins ───────────────────
create or replace function list_admins()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from users
  where role = 'admin' and active and mandal_id = app_mandal_id()
$$;

revoke execute on function list_admins() from public;
grant execute on function list_admins() to authenticated;

-- ── get_expense_categories: `select … from mandal_config` returned N rows
-- for N mandals. This one breaks outright, not just leaks.
create or replace function get_expense_categories()
returns text[]
language sql stable security definer set search_path = public as $$
  select expense_categories from mandals where id = app_mandal_id()
$$;

revoke execute on function get_expense_categories() from public;
grant execute on function get_expense_categories() to authenticated;
```

- [ ] **Step 3: Re-scope the transparency RPCs by slug**

Append to the migration:

```sql
-- ── Transparency: per-mandal, addressed by slug ────────────────────────
-- Two leaks fixed here. (1) The sums had no mandal filter, so public totals
-- mixed every mandal's money together. (2) The admin bypass was a bare
-- is_admin(), which would let ANY mandal's admin preview ANY other mandal's
-- UNPUBLISHED totals — it must be is_admin() AND same-mandal.
--
-- An unknown slug returns zero rows, exactly like an unpublished report, so
-- this leaks nothing about which slugs exist.

drop function get_transparency_report();
create or replace function get_transparency_report(mandal_slug text)
returns table (total_collected_paise bigint, total_expenses_paise bigint)
language sql stable security definer set search_path = public as $$
  with m as (select id, transparency_published from mandals where slug = mandal_slug)
  select
    coalesce((select sum(amount_paise) from donations
               where not voided and mandal_id = (select id from m)), 0),
    coalesce((select sum(amount_paise) from expenses
               where not voided and mandal_id = (select id from m)), 0)
  from m
  where m.transparency_published or (is_admin() and app_mandal_id() = m.id)
$$;

drop function get_transparency_categories();
create or replace function get_transparency_categories(mandal_slug text)
returns table (category text, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  with m as (select id, transparency_published from mandals where slug = mandal_slug)
  select e.category, sum(e.amount_paise)
  from expenses e, m
  where not e.voided
    and e.mandal_id = m.id
    and (m.transparency_published or (is_admin() and app_mandal_id() = m.id))
  group by e.category
$$;

revoke execute on function get_transparency_report(text) from public;
revoke execute on function get_transparency_categories(text) from public;
grant execute on function get_transparency_report(text) to anon, authenticated;
grant execute on function get_transparency_categories(text) to anon, authenticated;
```

- [ ] **Step 4: Add `create_mandal()`**

Append to the migration:

```sql
-- ── Self-serve signup ──────────────────────────────────────────────────
-- The only way a mandal is ever created. SECURITY DEFINER because the
-- caller has no `users` row yet, so no policy can apply to them: they are
-- not a member of anything at the moment they call this.
create or replace function create_mandal(mandal_name text, admin_name text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  my_email text;
  base     text;
  candidate text;
  new_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Volunteer sessions are anonymous (signInAnonymously) and must never be
  -- able to create a mandal.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous sessions cannot create a mandal';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then
    raise exception 'account has no verified email';
  end if;

  -- The one-mandal-per-email cap, enforced in the database rather than the
  -- UI. users.auth_user_id is UNIQUE, so this is also what "one account,
  -- one mandal" means structurally.
  if exists (select 1 from users where auth_user_id = auth.uid()) then
    raise exception 'this account already belongs to a mandal';
  end if;

  -- A mandal named entirely in Devanagari slugifies to '' — the target
  -- market, not an edge case. Truncate before suffixing so the check
  -- constraint's 40-char bound can't be breached by a long name.
  base := left(coalesce(nullif(slugify(mandal_name), ''), 'mandal'), 40);

  insert into mandals (name, slug) values (mandal_name, base)
  returning id into new_id;

  return new_id;
exception
  when unique_violation then
    -- Either the slug collided or the email is already an invited admin
    -- elsewhere. Distinguish, because the fixes are completely different.
    if exists (select 1 from users where email = my_email) then
      raise exception 'this email was already invited to a mandal; open your invite link instead';
    end if;
    raise;
end;
$$;
```

Note this version is deliberately incomplete — it creates the mandal but not its admin, and does not retry a slug collision. Step 5 fixes both; the split exists so the slug-retry loop lands with the test that proves it.

- [ ] **Step 5: Add the slug-retry loop and the first admin insert**

Replace the `create_mandal` body from Step 4 with the complete version:

```sql
create or replace function create_mandal(mandal_name text, admin_name text)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  my_email  text;
  base      text;
  candidate text;
  suffix    int := 1;
  new_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous sessions cannot create a mandal';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then
    raise exception 'account has no verified email';
  end if;

  if exists (select 1 from users where auth_user_id = auth.uid()) then
    raise exception 'this account already belongs to a mandal';
  end if;

  if exists (select 1 from users where email = my_email) then
    raise exception 'this email was already invited to a mandal; open your invite link instead';
  end if;

  base := left(coalesce(nullif(slugify(mandal_name), ''), 'mandal'), 40);
  candidate := base;

  -- Try base, then base-2, base-3 … A concurrent signup racing for the same
  -- slug loses the insert, lands here, and retries the next candidate
  -- rather than producing a duplicate. Bounded, then a random suffix.
  loop
    begin
      insert into mandals (name, slug) values (mandal_name, candidate)
      returning id into new_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      if suffix > 50 then
        candidate := base || '-' || substr(gen_random_uuid()::text, 1, 6);
      else
        candidate := base || '-' || suffix;
      end if;
    end;
  end loop;

  insert into users (mandal_id, name, email, role, auth_user_id, active)
  values (new_id, admin_name, my_email, 'admin', auth.uid(), true);

  return new_id;
end;
$$;

revoke execute on function create_mandal(text, text) from public;
grant execute on function create_mandal(text, text) to authenticated;
```

The `users` insert bypasses `users_admin_insert` (which requires `is_admin()`, and the caller is not an admin of anything yet) — that is exactly why this function is SECURITY DEFINER, and why there is no INSERT policy on `mandals`.

- [ ] **Step 6: Run the script**

Run: `bash supabase/verify-local.sh`
Expected: still FAIL on `seed.sql` (it inserts into `mandal_config`, which Task 4 drops and rewrites). Confirm no errors from any `create or replace function` statement. Do not commit yet.

---

### Task 4: Drop `mandal_config`, rewrite the seed, prove tenant isolation

**Files:**
- Modify: `supabase/migrations/20260717120000_multi_tenancy.sql` (append — final statement)
- Modify: `supabase/seed.sql`
- Modify: `supabase/verify-local.sh` (append assertions)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a green `verify-local.sh`; seed with two mandals — `mandal-one` (`11111111-…-0001`) and `mandal-two` (`22222222-…-0002`).

- [ ] **Step 1: Drop the old table**

Append to `supabase/migrations/20260717120000_multi_tenancy.sql` — this must be the last statement, after every `select … from mandal_config` above has run:

```sql
-- ── Finally: the singleton is gone ─────────────────────────────────────
-- Every read of this table (the mandals backfill in this file) has already
-- happened by now. Its policies drop with it.
drop table mandal_config;
```

- [ ] **Step 2: Rewrite `seed.sql` with two mandals**

The seed's whole job changes: it must now produce the two-tenant fixture that the isolation assertions run against. Replace the entire contents of `supabase/seed.sql`:

```sql
-- Two mandals, so that every RLS assertion in verify-local.sh has a
-- negative control. A single-mandal seed cannot prove isolation: with one
-- tenant, a policy that forgot its mandal predicate passes every test.

insert into mandals (id, name, slug, receipt_prefix, expense_categories, bank_opening_paise) values
  ('11111111-1111-1111-1111-000000000001', 'Vinayak Mitra Mandal', 'mandal-one', 'VM',
   '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}', 500000),
  ('22222222-2222-2222-2222-000000000002', 'Ganesh Seva Mandal', 'mandal-two', 'GS',
   '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}', 100000)
on conflict (id) do nothing;

-- Mandal One: one admin, two volunteers (matches the pre-multi-tenancy
-- seed's ids so existing assertions keep working).
insert into users (id, mandal_id, name, phone, role, active) values
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-000000000001',
   'Admin Treasurer', '9000000001', 'admin', true)
on conflict (id) do nothing;

insert into users (id, mandal_id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-000000000001',
   'Volunteer One', '9000000002', 'volunteer', 'seed-invite-token-vol1', true),
  ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-000000000001',
   'Volunteer Two', '9000000003', 'volunteer', 'seed-invite-token-vol2', true)
on conflict (id) do nothing;

update users set email = 'admin@example.com' where id = '00000000-0000-0000-0000-000000000001';

-- Mandal Two: the negative control. Its admin is the session every
-- isolation assertion tries (and must fail) to read Mandal One's data from.
insert into users (id, mandal_id, name, phone, role, active) values
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-000000000002',
   'Other Admin', '9000000011', 'admin', true)
on conflict (id) do nothing;

insert into users (id, mandal_id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-000000000002',
   'Other Volunteer', '9000000012', 'volunteer', 'seed-invite-token-other', true)
on conflict (id) do nothing;

update users set email = 'other-admin@example.com' where id = '00000000-0000-0000-0000-0000000000b1';

-- auth.users rows so the verify script's jwt-claim sessions resolve. The
-- real Supabase auth schema owns these; the local stub needs them seeded.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000b1', 'other-admin@example.com')
on conflict (id) do nothing;

update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000b1'
where id = '00000000-0000-0000-0000-0000000000b1';
```

- [ ] **Step 3: Run the script — expect the pre-existing assertions to pass again**

Run: `bash supabase/verify-local.sh`
Expected: PASS, or a failure only in assertions that reference `mandal_config` directly (the `get_expense_categories` block near the end asserts `NOT EXISTS (SELECT 1 FROM mandal_config)`). Fix that assertion to reference `mandals` instead:

```sql
  ASSERT NOT EXISTS (SELECT 1 FROM mandals), 'FAIL: expected mandals direct select to be empty for a volunteer';
```

Re-run until `PASS: all migration/trigger/RLS assertions held.`

- [ ] **Step 4: Write the failing tenant-isolation assertions**

This is the gate for the whole project. Append to `supabase/verify-local.sh`, before the final `echo "== all assertions passed =="`:

```bash
echo "== assertion: TENANT ISOLATION — mandal two's admin cannot see mandal one =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Give mandal one some rows to try (and fail) to read.
set role postgres;
insert into donations (id, mandal_id, donor_name, amount_paise, mode, collected_by)
  values (gen_random_uuid(), '11111111-1111-1111-1111-000000000001',
          'M1 Donor', 50000, 'cash', '00000000-0000-0000-0000-000000000002');
insert into expenses (id, mandal_id, category, amount_paise, paid_by, paid_from)
  values (gen_random_uuid(), '11111111-1111-1111-1111-000000000001',
          'Mandap', 10000, '00000000-0000-0000-0000-000000000001', 'cash');
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- Other Admin, mandal two

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM donations
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s donations', v_count);

  SELECT count(*) INTO v_count FROM expenses
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s expenses', v_count);

  SELECT count(*) INTO v_count FROM handovers
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s handovers', v_count);

  SELECT count(*) INTO v_count FROM users
   WHERE mandal_id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, format('LEAK: mandal two admin saw %s of mandal one''s users', v_count);

  SELECT count(*) INTO v_count FROM mandals
   WHERE id = '11111111-1111-1111-1111-000000000001';
  ASSERT v_count = 0, 'LEAK: mandal two admin can read mandal one''s mandals row';

  -- list_admins() must not expose the other mandal's membership.
  SELECT count(*) INTO v_count FROM list_admins() WHERE name = 'Admin Treasurer';
  ASSERT v_count = 0, 'LEAK: list_admins() returned another mandal''s admin';
  RAISE NOTICE 'PASS: mandal two admin is fully isolated from mandal one';
END $$;
reset role;
SQL

echo "== assertion: TENANT ISOLATION — admin cannot preview another mandal's unpublished report =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
DECLARE
  v_count int;
BEGIN
  -- mandal-one is unpublished; the admin bypass must be same-mandal only.
  SELECT count(*) INTO v_count FROM get_transparency_report('mandal-one');
  ASSERT v_count = 0, 'LEAK: an admin previewed another mandal''s unpublished totals';

  SELECT count(*) INTO v_count FROM get_transparency_categories('mandal-one');
  ASSERT v_count = 0, 'LEAK: an admin previewed another mandal''s unpublished categories';

  -- An unknown slug must look identical to an unpublished one.
  SELECT count(*) INTO v_count FROM get_transparency_report('no-such-mandal');
  ASSERT v_count = 0, 'FAIL: unknown slug should return zero rows';
  RAISE NOTICE 'PASS: cross-mandal transparency preview is blocked';
END $$;
reset role;
SQL

echo "== assertion: mandal_id is stamped from the session, not the client =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one admin

-- Forge mandal_id: claim the row belongs to mandal two. The trigger must
-- overwrite it with the session's own mandal.
insert into donations (mandal_id, donor_name, amount_paise, mode, collected_by)
  values ('22222222-2222-2222-2222-000000000002', 'Forged Mandal Id', 100, 'cash',
          '00000000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_mandal uuid;
BEGIN
  SELECT mandal_id INTO v_mandal FROM donations WHERE donor_name = 'Forged Mandal Id';
  ASSERT v_mandal = '11111111-1111-1111-1111-000000000001',
    format('SECURITY HOLE: client-forged mandal_id was honoured (row landed in %s)', v_mandal);
  RAISE NOTICE 'PASS: forged mandal_id overridden by the insert trigger';
END $$;
reset role;
SQL

echo "== assertion: receipt numbers are per-mandal and gapless =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal two has issued no receipts yet, so its first donation must be
-- receipt #1 even though mandal one has already issued several.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('M2 First Donor', 100, 'cash', '00000000-0000-0000-0000-0000000000b1');

DO $$
DECLARE
  v_no bigint;
BEGIN
  SELECT receipt_no INTO v_no FROM donations WHERE donor_name = 'M2 First Donor';
  ASSERT v_no = 1, format('FAIL: mandal two''s first receipt should be 1, got %s', v_no);
END $$;

insert into donations (donor_name, amount_paise, mode, collected_by)
  values ('M2 Second Donor', 100, 'cash', '00000000-0000-0000-0000-0000000000b1');

DO $$
DECLARE
  v_no bigint;
BEGIN
  SELECT receipt_no INTO v_no FROM donations WHERE donor_name = 'M2 Second Donor';
  ASSERT v_no = 2, format('FAIL: mandal two''s second receipt should be 2, got %s', v_no);
  RAISE NOTICE 'PASS: receipt numbers restart per mandal and increment gaplessly';
END $$;
reset role;
SQL

echo "== assertion: create_mandal() guards =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role postgres;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'newfounder@example.com'),
  ('aaaaaaaa-0000-0000-0000-0000000000c2', 'devanagari@example.com')
on conflict (id) do nothing;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
set request.jwt.claims = '{"is_anonymous": false}';

DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('Shivaji Nagar Mandal', 'New Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug = 'shivaji-nagar-mandal', format('FAIL: unexpected slug %s', v_slug);

  ASSERT EXISTS (SELECT 1 FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'
                   AND role = 'admin' AND mandal_id = v_id),
    'FAIL: create_mandal did not create the first admin';

  -- The one-mandal-per-email cap.
  BEGIN
    PERFORM create_mandal('Second Mandal', 'New Founder');
    RAISE EXCEPTION 'FAIL: a second create_mandal for the same account succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already belongs to a mandal%' THEN
      RAISE NOTICE 'PASS: one-mandal-per-email cap held';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- A mandal named entirely in Devanagari must still get a valid slug.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
DECLARE
  v_id uuid;
  v_slug text;
BEGIN
  v_id := create_mandal('गणेश मंडळ', 'Devanagari Founder');
  SELECT slug INTO v_slug FROM mandals WHERE id = v_id;
  ASSERT v_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$',
    format('FAIL: Devanagari name produced an invalid slug: %s', v_slug);
  RAISE NOTICE 'PASS: Devanagari mandal name slugified to %', v_slug;
END $$;
reset role;

-- An anonymous (volunteer) session must never create a mandal.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
set request.jwt.claims = '{"is_anonymous": true}';
DO $$
BEGIN
  BEGIN
    PERFORM create_mandal('Anon Mandal', 'Anon');
    RAISE EXCEPTION 'SECURITY HOLE: an anonymous session created a mandal';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%anonymous%' THEN
      RAISE NOTICE 'PASS: anonymous session rejected by create_mandal()';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL
```

- [ ] **Step 5: Run the full script**

Run: `bash supabase/verify-local.sh`
Expected: `PASS: all migration/trigger/RLS assertions held.` and exit 0.

Any `LEAK:` or `SECURITY HOLE:` message means a policy is wrong — fix the migration, not the assertion. An assertion that is weakened to make the script pass is worse than no assertion, because it reads as proof.

- [ ] **Step 6: Commit the whole SQL change**

```bash
git add supabase/migrations/20260717120000_multi_tenancy.sql supabase/seed.sql supabase/verify-local.sh
git commit -m "feat(db): multi-tenancy — mandals table, mandal_id tenant key, per-mandal receipts

Adds mandal_id to every table with RLS scoped by a new app_mandal_id()
helper, stamps mandal_id server-side in the insert trigger, and moves
receipt numbers from one global sequence to a per-mandal counter.

Closes four cross-tenant leaks that self-serve signup would have opened:
public_mandal_branding (view over 'the one row'), list_admins (every
mandal's admins), get_expense_categories (N rows for N mandals), and the
transparency RPCs (unfiltered sums + a bare is_admin() preview bypass that
let any admin read any mandal's unpublished totals).

verify-local.sh now proves tenant isolation with a two-mandal seed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Regenerate types and fix the TypeScript that no longer compiles

**Files:**
- Modify: `src/lib/db/database.types.ts` (generated), `src/lib/db/config.ts`, `src/lib/db/receipt.ts`, `src/lib/db/transparency.ts`, `src/lib/db/ledger.ts:59-70`
- Modify: `src/features/settings/MandalConfig.tsx` — calls all three renamed/re-signatured functions
- Modify: `tests/config.test.ts`, `tests/MandalConfig.test.tsx`, `tests/AdminTransparency.test.tsx`, `tests/receipt.test.ts`, `tests/ReceiptPage.test.tsx`

**Interfaces:**
- Consumes: the migration's RPC signatures from Tasks 1–4.
- Produces: `type Mandal = Tables<'mandals'>` (replaces `MandalConfig`); `getMandal(): Promise<Mandal>`; `updateMandal(id: string, patch: TablesUpdate<'mandals'>): Promise<void>`; `getPublicReceipt(token)` now returns branding fields inline; `getTransparencyReport(slug: string)`; `getTransparencyCategories(slug: string)`. `getPublicBranding()` and `MandalBranding` are deleted.

- [ ] **Step 1: Regenerate the database types**

**Do NOT run `supabase db push` yourself.** The migration drops `mandal_config`, which holds
the live mandal's real config row. The repo owner pushes it themselves after taking a
snapshot. If `npm run db:types` below still emits `mandal_config`, the push has not happened
yet — **stop and report that**, do not push it, and do not hand-edit the generated file.

Run: `npm run db:types`
Expected: `src/lib/db/database.types.ts` rewrites — `mandal_config` and `public_mandal_branding` disappear, `mandals` appears (with `slug` and `next_receipt_no`), `get_public_receipt` gains its branding columns, `get_transparency_report`/`get_transparency_categories` gain `mandal_slug`, and `create_mandal` appears with `mandal_name`/`admin_name`/`slug_hint`.

- [ ] **Step 2: Run typecheck to see the full break surface**

Run: `npm run typecheck`
Expected: FAIL, with errors in `config.ts`, `receipt.ts`, `transparency.ts` and the five test files, all of the form `Type '"mandal_config"' does not satisfy the constraint` / `Property 'public_mandal_branding' does not exist`.

- [ ] **Step 3: Rewrite `config.ts`**

Replace the top of `src/lib/db/config.ts` through `updateMandalConfig`:

```ts
// Typed query module for the mandals table + its Storage assets. RLS
// (mandals_admin_* / mandal_assets_admin_*) already enforces admin-only,
// same-mandal writes server-side, so nothing here re-checks role or
// mandal — callers just route the screen behind RequireRole role="admin".
import { supabase } from './client'
import type { Tables, TablesUpdate } from './database.types'

export type Mandal = Tables<'mandals'>
export type MandalAssetKind = 'logo' | 'signature' | 'upi_qr'

const ASSETS_BUCKET = 'mandal-assets'

// RLS scopes this to the caller's own mandal, so `single()` still returns
// exactly one row — the tenant filter is server-side, not a client `.eq()`.
export async function getMandal(): Promise<Mandal> {
  const { data, error } = await supabase.from('mandals').select('*').single()
  if (error) throw error
  return data
}

export async function getExpenseCategories(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_expense_categories')
  if (error) throw error
  return data ?? []
}

// The id filter is defence in depth, not the guard: mandals_admin_update's
// `id = app_mandal_id()` is what actually prevents writing another mandal's
// row. The old `.eq('id', true)` targeted the boolean singleton PK, which
// no longer exists.
export async function updateMandal(id: string, patch: TablesUpdate<'mandals'>): Promise<void> {
  const { error } = await supabase.from('mandals').update(patch).eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 4: Scope uploaded asset paths by mandal**

The storage policy added in Task 2 requires the first path segment to be the mandal id. Replace `uploadMandalAsset` in `src/lib/db/config.ts`:

```ts
// Path is `<mandal_id>/<kind>-<timestamp>.<ext>` — the mandal_assets_admin_write
// policy checks (storage.foldername(name))[1] against app_mandal_id(), so a
// flat path is rejected outright now.
export async function uploadMandalAsset(mandalId: string, kind: MandalAssetKind, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${mandalId}/${kind}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, { upsert: true })
  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path)
  return publicUrl
}
```

- [ ] **Step 5: Rewrite `receipt.ts` — branding now arrives with the receipt**

Replace the entire contents of `src/lib/db/receipt.ts`:

```ts
// Typed read access for the public receipt page. get_public_receipt is
// safe by construction: it takes an unguessable token, returns exactly one
// row, and never includes donor_phone at the SQL level. It now also returns
// that receipt's own mandal branding — the public_mandal_branding view was
// a view over "the one row" and could not survive multi-tenancy.
import { supabase } from './client'
import type { Database } from './database.types'

// void_reason is corrected to `| null` here: the hosted type generator can't
// infer nullability through a `language sql returns table(...)` function, so
// it always emits the column as non-null even though donations.void_reason
// (and thus this RPC's real result for a non-voided receipt) is nullable.
// The same applies to every nullable branding column.
export type PublicReceipt = Omit<
  Database['public']['Functions']['get_public_receipt']['Returns'][number],
  'void_reason' | 'logo_url' | 'signature_url'
> & {
  void_reason: string | null
  logo_url: string | null
  signature_url: string | null
}

// Returns null for a bogus/unknown token (RPC returns zero rows) rather than
// throwing — that's the "not found" state, not an error state.
export async function getPublicReceipt(token: string): Promise<PublicReceipt | null> {
  const { data, error } = await supabase.rpc('get_public_receipt', { token })
  if (error) throw error
  return data?.[0] ?? null
}
```

- [ ] **Step 6: Rewrite `transparency.ts` to take a slug**

Replace the two functions in `src/lib/db/transparency.ts`:

```ts
export async function getTransparencyReport(mandalSlug: string): Promise<TransparencyTotals | null> {
  const { data, error } = await supabase.rpc('get_transparency_report', { mandal_slug: mandalSlug })
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return { totalCollectedPaise: row.total_collected_paise, totalExpensesPaise: row.total_expenses_paise }
}

export async function getTransparencyCategories(mandalSlug: string): Promise<CategoryBreakdown[]> {
  const { data, error } = await supabase.rpc('get_transparency_categories', { mandal_slug: mandalSlug })
  if (error) throw error
  return (data ?? []).map((row) => ({ category: row.category, amountPaise: row.amount_paise }))
}
```

- [ ] **Step 7: Follow the rename in `ledger.ts`**

In `src/lib/db/ledger.ts`, change the import on line 7 from `getMandalConfig` to `getMandal`, and the call inside `fetchFullLedger` (line ~68) from `getMandalConfig()` to `getMandal()`. The `bank_opening_paise` read is unchanged — the column kept its name.

- [ ] **Step 8: Update `MandalConfig.tsx` — it calls all three changed functions**

`src/features/settings/MandalConfig.tsx` imports `getMandalConfig`, `updateMandalConfig`, and `uploadMandalAsset`. All three changed. It also needs to hold the mandal id now, because `updateMandal` and `uploadMandalAsset` both take it.

Change the import block (lines 2–8):

```tsx
import {
  getMandal,
  updateMandal,
  uploadMandalAsset,
  type MandalAssetKind,
  type Mandal,
} from '../../lib/db/config'
```

Add an id to state, next to the other `useState` calls:

```tsx
  const [mandalId, setMandalId] = useState<string | null>(null)
```

In the effect, rename the type and capture the id — `applyConfig(config: MandalConfig)` becomes:

```tsx
    function applyConfig(config: Mandal) {
      setMandalId(config.id)
      setName(config.name)
      setUpiVpa(config.upi_vpa ?? '')
      setLogoUrl(config.logo_url)
      setSignatureUrl(config.signature_url)
      setUpiQrUrl(config.upi_qr_url)
      setCategories(config.expense_categories)
      setBankOpeningRupees(String(toRupees(config.bank_opening_paise)))
    }
```

and the call on line 48 becomes `getMandal()`.

At line ~72, the upload now needs the mandal id for its path prefix (the storage policy rejects a flat path):

```tsx
      if (!mandalId) return
      const url = await uploadMandalAsset(mandalId, kind, file)
```

At line ~101, the save becomes:

```tsx
      if (!mandalId) return
      await updateMandal(mandalId, {
```

Also update the stale comment at lines 14–16 — it says "the single-row mandal_config table":

```tsx
// Admin-only screen (routed behind RequireRole role="admin"). Single form
// over the admin's own mandals row + its three Storage-backed assets —
// RLS scopes the row, so there's no tenant filter here. No volunteer
// management on this screen, that's settings/volunteers.tsx.
```

- [ ] **Step 9: Update the five broken test files**

These are mechanical, but not optional — `npm run typecheck` fails until they are done.

In `tests/config.test.ts`: change the import to `getMandal, getExpenseCategories, updateMandal, uploadMandalAsset`; change `Tables<'mandal_config'>` to `Tables<'mandals'>`; replace `id: true` in `configRow` with `id: '11111111-1111-1111-1111-000000000001'`, and add the columns `mandals` has that `mandal_config` did not:

```ts
const configRow: Tables<'mandals'> = {
  id: '11111111-1111-1111-1111-000000000001',
  name: 'Vinayak Mitra Mandal',
  slug: 'vinayak-mitra-mandal',
  logo_url: null,
  signature_url: null,
  upi_vpa: null,
  upi_qr_url: null,
  receipt_prefix: 'VM',
  expense_categories: ['Misc'],
  bank_opening_paise: 500000,
  transparency_published: false,
  next_receipt_no: 1,
  created_at: '2026-07-17T00:00:00.000Z',
}
```

Update the `from` assertion from `expect(from).toHaveBeenCalledWith('mandal_config')` to `'mandals'`, and the `updateMandal` test's filter assertion from `.eq('id', true)` to `.eq('id', '11111111-1111-1111-1111-000000000001')`. `uploadMandalAsset` now takes `mandalId` first — update its call and assert the path starts with the mandal id.

In `tests/MandalConfig.test.tsx` and `tests/AdminTransparency.test.tsx`: rename the mocked `getMandalConfig`/`updateMandalConfig` to `getMandal`/`updateMandal`, and reuse the same `Tables<'mandals'>` fixture shape above.

In `tests/receipt.test.ts`: delete the entire `describe('getPublicBranding')` block and the `brandingRow` fixture — that function no longer exists. Add the branding fields to the `get_public_receipt` fixture row instead.

In `tests/ReceiptPage.test.tsx`: drop `getPublicBranding` from the `vi.hoisted`/`vi.mock` block and from `beforeEach`; fold the `branding` fixture's fields into the `getPublicReceipt` mock's resolved row.

- [ ] **Step 10: Verify**

Run: `npm run typecheck`
Expected: PASS, zero errors.

Run: `npm run test -- --run`
Expected: PASS. `money.ts`/`reconcile.ts` coverage still 100% (they were not touched — if they were, revert that).

- [ ] **Step 11: Commit**

```bash
git add src/lib/db/ src/features/settings/MandalConfig.tsx tests/
git commit -m "refactor(db): follow the mandals rename through the client and tests

getMandalConfig/updateMandalConfig -> getMandal/updateMandal, receipt
branding now arrives with get_public_receipt (the public_mandal_branding
view is gone), transparency RPCs take a mandal slug, and asset uploads are
scoped under a <mandal_id>/ path prefix to satisfy the new storage policy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Signup — create your mandal

**Files:**
- Create: `src/lib/db/mandals.ts`, `src/features/auth/Signup.tsx`, `tests/mandals.test.ts`, `tests/Signup.test.tsx`
- Modify: `src/lib/strings.ts`, `src/app/router.tsx`, `src/features/auth/RequireRole.tsx`, `src/features/landing/LandingPage.tsx` (final CTA link target)

**`AuthProvider.tsx` needs no change.** It already resolves `appUser` to `null` when the session has no `users` row, and `link_admin_account()` is already a documented no-op for a non-admin email. The "authed but no mandal" state is handled entirely in `RequireRole` (Step 11).

**Interfaces:**
- Consumes: `create_mandal(mandal_name, admin_name, slug_hint)` from Task 3 — note the **third, optional** arg added during the dry run; `useAuth()` → `{ session, appUser, loading, refreshAppUser }` from `src/features/auth/useAuth.ts`.
- Produces: `createMandal(mandalName: string, adminName: string, slugHint?: string): Promise<string>` from `src/lib/db/mandals.ts`; `<Signup />` at route `/signup`.

**Slug field requirement (changed from the original plan).** The signup form has a third input: the mandal's public link. It is optional — leave it blank and the DB derives one from the name. It exists because `slugify()` is ASCII-only: a mandal named `गणेश मंडळ` gets `mandal`, then `mandal-2`, `mandal-3`, which makes the transparency link useless for exactly the mandals this app serves. Show the resulting URL inline (`/transparency/<slug>`) so the founder can see what they're choosing. Pass `undefined` (not `''`) when blank, so the RPC's `default null` applies.

- [ ] **Step 1: Write the failing test for the RPC wrapper**

Create `tests/mandals.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMandal } from '../src/lib/db/mandals'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/db/client', () => ({ supabase: { rpc } }))

beforeEach(() => vi.clearAllMocks())

describe('createMandal', () => {
  it('calls the create_mandal RPC and returns the new mandal id', async () => {
    rpc.mockResolvedValue({ data: '11111111-1111-1111-1111-000000000001', error: null })

    const id = await createMandal('Shivaji Nagar Mandal', 'New Founder')

    expect(rpc).toHaveBeenCalledWith('create_mandal', {
      mandal_name: 'Shivaji Nagar Mandal',
      admin_name: 'New Founder',
    })
    expect(id).toBe('11111111-1111-1111-1111-000000000001')
  })

  it('throws the RPC error so the caller can show the DB message verbatim', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('this account already belongs to a mandal') })

    await expect(createMandal('X', 'Y')).rejects.toThrow('this account already belongs to a mandal')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/mandals.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/db/mandals"`.

- [ ] **Step 3: Write the wrapper**

Create `src/lib/db/mandals.ts`:

```ts
// The one pre-membership call in the app: createMandal runs when the caller
// has authenticated but has no `users` row yet, so no RLS policy can apply
// to them. That's why create_mandal is SECURITY DEFINER server-side, and
// why this lives outside config.ts (everything there assumes a resolved
// mandal).
import { supabase } from './client'

export async function createMandal(mandalName: string, adminName: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_mandal', {
    mandal_name: mandalName,
    admin_name: adminName,
  })
  if (error) throw error
  return data
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/mandals.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the signup copy**

In `src/lib/strings.ts`, add a `signup` key after the `auth` block:

```ts
  signup: {
    title: 'Start your mandal',
    intro: 'Create your mandal and you become its first admin. You can invite your team next.',
    mandalNameLabel: 'Mandal name',
    adminNameLabel: 'Your name',
    submit: 'Create mandal',
    submitting: 'Creating…',
  },
```

No landing-page string is added. The landing page's primary CTA already reads
**"Start your mandal free"** (`strings.landing.finalCta.ctaPrimary`) — it just points at
`/login` today, which is a dead end for someone who has no account yet. Step 10 repoints it.

- [ ] **Step 6: Write the failing test for the screen**

Create `tests/Signup.test.tsx`:

Note: this project has **no** `@testing-library/user-event` — every existing screen test drives the DOM with `fireEvent` (see `tests/CollectionForm.test.tsx`). Use `fireEvent`; adding the dependency would violate this plan's no-new-dependency constraint for a test helper the codebase has never needed.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Signup } from '../src/features/auth/Signup'

const { createMandal, refreshAppUser, navigate } = vi.hoisted(() => ({
  createMandal: vi.fn(),
  refreshAppUser: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/lib/db/mandals', () => ({ createMandal }))
vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'auth-1' } }, appUser: null, loading: false, refreshAppUser }),
}))
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

beforeEach(() => vi.clearAllMocks())

function fillAndSubmit(mandalName: string, adminName: string) {
  fireEvent.change(screen.getByLabelText('Mandal name'), { target: { value: mandalName } })
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: adminName } })
  fireEvent.click(screen.getByRole('button', { name: 'Create mandal' }))
}

describe('Signup', () => {
  it('creates the mandal, refreshes the session user, and lands on the admin dashboard', async () => {
    createMandal.mockResolvedValue('11111111-1111-1111-1111-000000000001')
    render(<MemoryRouter><Signup /></MemoryRouter>)

    fillAndSubmit('Shivaji Nagar Mandal', 'New Founder')

    await waitFor(() => expect(createMandal).toHaveBeenCalledWith('Shivaji Nagar Mandal', 'New Founder'))
    // refreshAppUser must run before navigating: RequireRole reads appUser,
    // which is still null until the just-created users row is re-fetched.
    await waitFor(() => expect(refreshAppUser).toHaveBeenCalled())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin', { replace: true }))
  })

  it('shows the database error verbatim when the account already has a mandal', async () => {
    createMandal.mockRejectedValue(new Error('this account already belongs to a mandal'))
    render(<MemoryRouter><Signup /></MemoryRouter>)

    fillAndSubmit('Second Mandal', 'New Founder')

    expect(await screen.findByRole('alert')).toHaveTextContent('this account already belongs to a mandal')
    expect(navigate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test -- --run tests/Signup.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/features/auth/Signup"`.

- [ ] **Step 8: Write the screen**

Create `src/features/auth/Signup.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { createMandal } from '../../lib/db/mandals'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'

const t = strings.signup

// Reached after a magic link resolves for someone who has no `users` row
// yet — the one authenticated-but-not-a-member state in the app. Guarded on
// both sides: no session -> /login (get an identity first), already a member
// -> /admin (create_mandal would reject them anyway; don't show a form whose
// only outcome is an error).
export function Signup() {
  const { session, appUser, loading, refreshAppUser } = useAuth()
  const navigate = useNavigate()
  const [mandalName, setMandalName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-stone-400">{strings.auth.loading}</main>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (appUser) return <Navigate to="/admin" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createMandal(mandalName, adminName)
      // The users row exists now but this session's appUser is still null —
      // the auth state never changed, so no listener will re-resolve it.
      // RequireRole on /admin reads appUser, so refresh before navigating.
      await refreshAppUser()
      navigate('/admin', { replace: true })
    } catch (err) {
      // The DB's messages are already user-facing and specific (already has
      // a mandal / was invited elsewhere / anonymous session) — surfacing
      // them verbatim beats a generic "something went wrong".
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-stone-900">{t.title}</h1>
      <p className="text-center text-sm text-stone-600">{t.intro}</p>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <label htmlFor="mandal-name" className="text-sm text-stone-600">
          {t.mandalNameLabel}
        </label>
        <input
          id="mandal-name"
          type="text"
          required
          value={mandalName}
          onChange={(event) => setMandalName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="admin-name" className="text-sm text-stone-600">
          {t.adminNameLabel}
        </label>
        <input
          id="admin-name"
          type="text"
          required
          value={adminName}
          onChange={(event) => setAdminName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? t.submitting : t.submit}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npm run test -- --run tests/Signup.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 10: Route it and point the landing CTA at it**

In `src/app/router.tsx`, add the import `import { Signup } from '../features/auth/Signup'` and this route next to `/login`:

```tsx
      <Route path="/signup" element={<Signup />} />
```

In `src/features/landing/LandingPage.tsx`, the final CTA section (~line 586) already renders a `<Link>` labelled "Start your mandal free" — pointing at `/login`, which is a dead end for a founder with no account. Change only its target:

```tsx
          <Link
            to="/signup"
            className="inline-flex h-14 items-center rounded-2xl bg-orange-600 px-7.5 text-[17px] font-bold text-white shadow-lg shadow-orange-600/40 hover:bg-amber-500 hover:text-stone-900"
          >
            {t.finalCta.ctaPrimary}
          </Link>
```

Leave the header's "Log in" link (→ `/login`) and its "Start free →" anchor (→ `#cta`, which scrolls to this section) exactly as they are. The header anchor scrolling to the CTA that now routes to `/signup` is the correct funnel.

- [ ] **Step 11: Send authed-but-no-mandal users to signup instead of /login**

`RequireRole` currently sends anyone with `!appUser` to `/login`. After signup exists, a user who authed but has no mandal yet would bounce between `/login` and the magic link forever. In `src/features/auth/RequireRole.tsx`, replace the guard:

```tsx
  if (!session) {
    return <Navigate to="/login" replace />
  }

  // Authenticated, but not a member of any mandal yet — they came in via a
  // magic link and never created one. /login would just re-send a link and
  // loop them back here; /signup is the only exit.
  if (!appUser) {
    return <Navigate to="/signup" replace />
  }

  if (!allowedRoles.includes(appUser.role as Role)) {
    return <Navigate to="/login" replace />
  }
```

- [ ] **Step 12: Verify and commit**

Run: `npm run typecheck && npm run test -- --run`
Expected: PASS, all suites.

```bash
git add src/lib/db/mandals.ts src/features/auth/Signup.tsx src/features/auth/RequireRole.tsx src/app/router.tsx src/features/landing/LandingPage.tsx src/lib/strings.ts tests/mandals.test.ts tests/Signup.test.tsx
git commit -m "feat(auth): self-serve mandal signup

Adds /signup: an authenticated user with no users row creates their mandal
and becomes its first admin via the create_mandal RPC. RequireRole now
routes that state to /signup rather than looping it back to /login.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Slug-address the transparency pages

**Files:**
- Modify: `src/features/transparency/PublicTransparency.tsx`, `src/features/transparency/AdminTransparency.tsx`, `src/app/router.tsx`, `src/lib/strings.ts`
- Modify: `tests/AdminTransparency.test.tsx`
- Create: `tests/PublicTransparency.test.tsx`

**Interfaces:**
- Consumes: `getTransparencyReport(slug)` / `getTransparencyCategories(slug)` from Task 5; `getMandal()`/`updateMandal(id, patch)` from Task 5.
- Produces: route `/transparency/:slug`.

- [ ] **Step 1: Write the failing test for the public page**

Create `tests/PublicTransparency.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PublicTransparency } from '../src/features/transparency/PublicTransparency'

const { getTransparencyReport, getTransparencyCategories } = vi.hoisted(() => ({
  getTransparencyReport: vi.fn(),
  getTransparencyCategories: vi.fn(),
}))
vi.mock('../src/lib/db/transparency', () => ({ getTransparencyReport, getTransparencyCategories }))

beforeEach(() => vi.clearAllMocks())

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/transparency/${slug}`]}>
      <Routes>
        <Route path="/transparency/:slug" element={<PublicTransparency />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicTransparency', () => {
  it('passes the slug from the URL to both RPCs', async () => {
    getTransparencyReport.mockResolvedValue({ totalCollectedPaise: 100000, totalExpensesPaise: 40000 })
    getTransparencyCategories.mockResolvedValue([{ category: 'Mandap', amountPaise: 40000 }])

    renderAt('mandal-one')

    await waitFor(() => expect(getTransparencyReport).toHaveBeenCalledWith('mandal-one'))
    expect(getTransparencyCategories).toHaveBeenCalledWith('mandal-one')
  })

  it('shows the not-published state when the RPC returns no rows', async () => {
    getTransparencyReport.mockResolvedValue(null)
    getTransparencyCategories.mockResolvedValue([])

    renderAt('mandal-two')

    expect(await screen.findByText('The transparency report has not been published yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/PublicTransparency.test.tsx`
Expected: FAIL — `getTransparencyReport` called with `undefined`, or a type error on the zero-arg call.

- [ ] **Step 3: Read the slug from the route**

In `src/features/transparency/PublicTransparency.tsx`, add `useParams` to the react-router import, and replace the effect:

```tsx
export function PublicTransparency() {
  const { slug } = useParams<{ slug: string }>()
  const [totals, setTotals] = useState<TransparencyTotals | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let active = true
    Promise.all([getTransparencyReport(slug), getTransparencyCategories(slug)])
      .then(([report, categoryRows]) => {
        if (!active) return
        setTotals(report)
        setCategories(categoryRows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [slug])
```

The rest of the component is unchanged — an unknown slug returns zero rows from the RPC, which already renders the existing `notPublished` state. That is deliberate: an unknown mandal and an unpublished one must be indistinguishable.

- [ ] **Step 4: Update the route**

In `src/app/router.tsx`, change:

```tsx
      <Route path="/transparency" element={<PublicTransparency />} />
```
to:
```tsx
      <Route path="/transparency/:slug" element={<PublicTransparency />} />
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -- --run tests/PublicTransparency.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Give the admin the shareable link**

The slug's whole purpose is a link a mandal pastes into a WhatsApp group; without a visible copy affordance it is a column nobody uses.

In `src/lib/strings.ts`, add to the `transparency` block:

```ts
    publicLinkLabel: 'Public link',
    copyLink: 'Copy link',
    copied: 'Copied',
```

In `src/features/transparency/AdminTransparency.tsx`: change the import to `getMandal, updateMandal`, hold the mandal in state, and pass its slug through. Replace the effect and toggle:

```tsx
  const [mandal, setMandal] = useState<Mandal | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    getMandal()
      .then((m) => {
        if (!active) return
        setMandal(m)
        setPublished(m.transparency_published)
        return Promise.all([getTransparencyReport(m.slug), getTransparencyCategories(m.slug)])
      })
      .then((result) => {
        if (!active || !result) return
        const [report, categoryRows] = result
        setTotals(report)
        setCategories(categoryRows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleToggle() {
    if (!mandal) return
    setToggling(true)
    setError(null)
    try {
      await updateMandal(mandal.id, { transparency_published: !published })
      setPublished(!published)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setToggling(false)
    }
  }
```

Add `import { getMandal, updateMandal, type Mandal } from '../../lib/db/config'` and render the link block after the status paragraph:

```tsx
      {mandal && (
        <div className="flex items-center gap-2 rounded border border-stone-200 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone-500">{t.publicLinkLabel}</p>
            <p className="truncate text-sm text-stone-800">{`${window.location.origin}/transparency/${mandal.slug}`}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/transparency/${mandal.slug}`)
              setCopied(true)
            }}
            className="flex-none rounded border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700"
          >
            {copied ? t.copied : t.copyLink}
          </button>
        </div>
      )}
```

- [ ] **Step 7: Update the admin transparency test**

In `tests/AdminTransparency.test.tsx`, the mocked module names change (`getMandalConfig`→`getMandal`, `updateMandalConfig`→`updateMandal`, already done in Task 5) and the transparency RPCs now receive a slug. Add an assertion that the slug is threaded through:

```tsx
  it('passes its own mandal slug to the transparency RPCs', async () => {
    render(<AdminTransparency />)
    await waitFor(() => expect(getTransparencyReport).toHaveBeenCalledWith('vinayak-mitra-mandal'))
  })
```

The fixture's `slug` must match (`'vinayak-mitra-mandal'` per the Task 5 fixture).

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run test -- --run`
Expected: PASS, all suites.

```bash
git add src/features/transparency/ src/app/router.tsx src/lib/strings.ts tests/PublicTransparency.test.tsx tests/AdminTransparency.test.tsx
git commit -m "feat(transparency): address the public report by mandal slug

/transparency -> /transparency/:slug, and the admin screen surfaces the
shareable link with a copy button. An unknown slug renders identically to
an unpublished report, so the page leaks nothing about which slugs exist.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Receipt page reads branding from its own receipt

**Files:**
- Modify: `src/features/receipt/ReceiptPage.tsx:1-90`
- Modify: `tests/ReceiptPage.test.tsx`

**Interfaces:**
- Consumes: `getPublicReceipt(token)` from Task 5, now returning `mandal_name`, `logo_url`, `signature_url`, `receipt_prefix` inline.
- Produces: nothing new.

- [ ] **Step 1: Update the test to a single-call shape**

In `tests/ReceiptPage.test.tsx` (already de-mocked of `getPublicBranding` in Task 5), assert the branding renders from the receipt row:

```tsx
  it('renders the mandal name and logo that came back with the receipt', async () => {
    getPublicReceipt.mockResolvedValue({
      receipt_no: 7,
      donor_name: 'Donor Name',
      amount_paise: 50000,
      mode: 'cash',
      created_at: '2026-07-17T00:00:00.000Z',
      voided: false,
      void_reason: null,
      mandal_name: 'Ganesh Seva Mandal',
      logo_url: 'https://example.test/logo.png',
      signature_url: null,
      receipt_prefix: 'GS',
    })

    render(<MemoryRouter initialEntries={['/r/token-1']}>
      <Routes><Route path="/r/:public_token" element={<ReceiptPage />} /></Routes>
    </MemoryRouter>)

    expect(await screen.findByText('Ganesh Seva Mandal')).toBeInTheDocument()
    expect(await screen.findByText('GS-000007')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/ReceiptPage.test.tsx`
Expected: FAIL — the component still calls `getPublicBranding`, which is no longer exported.

- [ ] **Step 3: Collapse the two fetches into one**

In `src/features/receipt/ReceiptPage.tsx`: change the import to `import { getPublicReceipt, type PublicReceipt } from '../../lib/db/receipt'`, drop `MandalBranding` from `PageState`:

```tsx
type PageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'found'; receipt: PublicReceipt }
```

Replace the load function's body:

```tsx
      try {
        const receipt = await getPublicReceipt(public_token)
        if (!active) return
        setState(receipt ? { status: 'found', receipt } : { status: 'not-found' })
      } catch {
        if (active) setState({ status: 'not-found' })
      }
```

And replace the destructure + branding reads below it:

```tsx
  const { receipt } = state
  const mandalName = receipt.mandal_name
  const receiptNumber = `${receipt.receipt_prefix}-${String(receipt.receipt_no).padStart(6, '0')}`
  const stampLabel = receipt.mode === 'cash' ? t.stampCash : t.stampOnline
```

Then, in the JSX, change `branding?.logo_url` → `receipt.logo_url` and `branding?.signature_url` → `receipt.signature_url`. `mandalName` no longer needs the `?? strings.appName` fallback: the RPC joins `mandals`, and a receipt cannot exist without one.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- --run tests/ReceiptPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test -- --run`
Expected: PASS, all suites.

```bash
git add src/features/receipt/ReceiptPage.tsx tests/ReceiptPage.test.tsx
git commit -m "feat(receipt): render the receipt's own mandal branding

get_public_receipt now returns branding joined from the receipt's mandal,
so the page drops from two round trips to one and can never show another
mandal's logo.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end — signup to receipt

**Files:**
- Create: `e2e/mandal-signup.spec.ts`
- Modify: any existing spec that navigates to `/transparency`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Find the specs that break on the transparency route change**

Run: `grep -rn "/transparency" e2e/`
Expected: any hit navigating to bare `/transparency` must become `/transparency/mandal-one` (the seed slug from Task 4). If there are no hits, skip to Step 2.

- [ ] **Step 2: Write the signup e2e spec**

A real magic-link round trip needs live email delivery, so `e2e/admin-auth.spec.ts` established the pattern this project uses instead: inject a fake session into `localStorage` via `addInitScript`, then `page.route` the Supabase REST calls. This spec reuses exactly that, with one addition — the `users` lookup must return "no row" *before* signup and the created row *after*, which is what makes this the signup flow rather than a login flow.

Create `e2e/mandal-signup.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const SUPABASE_URL = 'http://127.0.0.1:54321'
const STORAGE_KEY = 'sb-127-auth-token'
const AUTH_USER_ID = 'fake-founder-auth-id'
const MANDAL_ID = '33333333-3333-3333-3333-000000000003'

// Same shape as e2e/admin-auth.spec.ts's helper — a founder's session is an
// ordinary email session; what makes them a founder is having no users row.
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

// The self-serve path the landing page advertises but could not deliver
// before multi-tenancy: land -> signup -> become admin of a brand-new
// mandal -> reach the dashboard.
test('a new founder can create a mandal and reach the admin dashboard', async ({ page }) => {
  let mandalCreated = false

  await page.addInitScript(
    ({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)),
    { key: STORAGE_KEY, session: fakeStoredSession(AUTH_USER_ID) },
  )

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )

  // Before create_mandal: no users row (maybeSingle -> null), which is what
  // routes this session to /signup. After: the row create_mandal inserted.
  await page.route(`${SUPABASE_URL}/rest/v1/users*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: mandalCreated
        ? JSON.stringify({
            id: 'user-founder-1',
            mandal_id: MANDAL_ID,
            name: 'E2E Founder',
            phone: null,
            email: 'founder@example.com',
            role: 'admin',
            invite_token: null,
            auth_user_id: AUTH_USER_ID,
            active: true,
            created_at: new Date().toISOString(),
          })
        : 'null',
    }),
  )

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_mandal*`, (route) => {
    mandalCreated = true
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANDAL_ID) })
  })

  await page.goto('/')
  await page.getByRole('link', { name: 'Start your mandal free' }).click()
  await expect(page).toHaveURL(/\/signup$/)

  await page.getByLabel('Mandal name').fill('E2E Test Mandal')
  await page.getByLabel('Your name').fill('E2E Founder')
  await page.getByRole('button', { name: 'Create mandal' }).click()

  await expect(page).toHaveURL(/\/admin$/)
})
```

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS.

If `/admin` renders something that needs further stubbing (the ledger fetches `mandals` + `donations`), add `page.route` handlers for those returning empty arrays — the assertion under test is the URL, not the dashboard's contents. Do **not** weaken the URL assertion to make it pass.

- [ ] **Step 4: Full verification**

Run: `bash supabase/verify-local.sh && npm run typecheck && npm run lint && npm run test -- --run`
Expected: all four green.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): cover signup -> create mandal -> admin dashboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Update SPEC.md

**Files:**
- Modify: `SPEC.md:12` (assumption 2), `SPEC.md` data model + auth sections

**Interfaces:** none.

- [ ] **Step 1: Correct the multi-tenancy assumption**

`SPEC.md` assumption 2 currently reads:

```
2. **Single mandal.** No multi-tenancy. The mandal's identity (name, logo, signature, UPI VPA/QR, expense categories, receipt-number prefix) is a single config row.
```

Replace with:

```
2. **Multi-tenant.** Each mandal is a row in `mandals`, holding its identity (name, slug, logo, signature, UPI VPA/QR, expense categories, receipt-number prefix). Every table carries a `mandal_id`; `users.mandal_id` is the tenant key, read through `app_mandal_id()` and enforced by RLS on every policy. One account belongs to exactly one mandal. Mandals are created only by the `create_mandal()` RPC (self-serve signup, one mandal per verified email).
```

- [ ] **Step 2: Update the data model section**

In `SPEC.md`'s Data Model block, replace the `mandal_config` definition with the `mandals` table from `supabase/migrations/20260717120000_multi_tenancy.sql`, and add `mandal_id uuid not null references mandals(id)` to `users`, `donations`, `expenses`, and `handovers`.

Replace the line:

```
`receipt_no` is allocated server-side (Postgres sequence or a transactional counter) so numbers are gapless and unique.
```
with:
```
`receipt_no` is allocated server-side from `mandals.next_receipt_no`, incremented under a row lock in the insert trigger, so numbers are gapless and unique **per mandal**. `mandal_id` is likewise stamped by the trigger from the session — never accepted from the client.
```

- [ ] **Step 3: Update the Auth section**

Add to `SPEC.md`'s Auth section:

```
- **Signup:** anyone can create a mandal via email magic link → `create_mandal()`, becoming its first admin. Anonymous (volunteer) sessions are rejected. One mandal per verified email, enforced by the database.
```

- [ ] **Step 4: Add the tenant-isolation boundary**

In `SPEC.md`'s Boundaries → **Always** list, add:

```
scope every RLS policy and every mandal-taking SECURITY DEFINER RPC by `app_mandal_id()`; stamp `mandal_id` server-side, never from the client
```

And to **Never**:

```
expose an RPC that takes a mandal identifier and returns unpublished or donor-level data without an `app_mandal_id()` check
```

- [ ] **Step 5: Commit**

```bash
git add SPEC.md
git commit -m "docs: SPEC.md is multi-tenant now

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification Checklist

Run before calling Project A done:

```bash
bash supabase/verify-local.sh     # tenant isolation + receipt numbering + create_mandal guards
npm run typecheck
npm run lint
npm run test -- --run             # incl. 100% coverage on money.ts / reconcile.ts
npm run test:e2e
```

Against the spec's Success Criteria:

| # | Criterion | Proven by |
|---|---|---|
| 1 | Each admin sees only their own rows | Task 4 tenant-isolation assertions |
| 2 | Per-mandal gapless receipt numbers | Task 4 receipt-numbering assertions |
| 3 | Forged `mandal_id` lands in the caller's own mandal | Task 4 stamping assertion |
| 4 | Signup reaches the dashboard with no manual DB work | Task 6 tests + Task 9 e2e |
| 5 | Second signup from the same email refused by the DB | Task 4 `create_mandal` guards |
| 6 | Anonymous session cannot create a mandal | Task 4 `create_mandal` guards |
| 7 | No cross-mandal unpublished preview | Task 4 transparency assertions |
| 8 | `/transparency/:slug` and `/r/:token` are mandal-correct | Tasks 7–8 tests |
| 9 | Devanagari name yields a valid unique slug | Task 4 `create_mandal` guards |
| 10 | Isolation green; money coverage still 100% | Task 4 + Task 5 |
| 11 | Existing sessions survive the migration | Task 1 backfill + Task 4 seed |
