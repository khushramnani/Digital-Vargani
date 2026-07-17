# Spec: Multi-Tenancy, Mandal Onboarding & Team Management (Project A)

> Converts the app from hard-wired single-mandal to many independent mandals, each with
> self-serve signup, its own team, its own books, and its own gapless receipt numbers.
> Supersedes SPEC.md assumption #2 ("Single mandal. No multi-tenancy.").
>
> Project B (multi-language receipts, Cloudinary uploads, receipt redesign) is specced
> separately and depends on this landing first.

## Objective

Let any mandal sign up on their own, create their mandal, invite their own admins and
volunteers, and run their books — with a hard guarantee that no mandal can see, count, or
touch another mandal's data.

**Success looks like:** two mandals collecting donations on the same day, each seeing
receipt numbers 1, 2, 3… of their own, and an admin of one mandal getting exactly zero rows
from the other's donations, users, handovers, expenses, and transparency totals.

## Why this is one project and not three

Onboarding, teams, and per-mandal branding all reduce to the same change: a `mandal_id`
tenant key on every table and an RLS rewrite around it. They cannot land independently —
a half-migrated schema is a schema where one mandal reads another's donor list.

This project touches the money-correctness core (`receipt_no` allocation) and every RLS
policy. It ships alone, with the isolation test below as its gate.

## Current state (why each change is forced)

Read from the live schema at `supabase/migrations/*`:

| Fact today | Breaks how, once a second mandal exists |
|---|---|
| `mandal_config.id boolean primary key check (id)` | Schema physically cannot store a second mandal. |
| `receipt_no bigint default nextval('receipt_no_seq')` | One global sequence. Mandal A gets 1, B gets 2, A gets 3 — every book looks full of holes. |
| Every policy is `is_admin()` | "Am I an admin", with no "of which mandal". Any admin reads every mandal's rows. |
| `create view public_mandal_branding` | A view over "the one row". With many rows it hands every mandal's branding to `anon`. |
| `list_admins()` → `where role='admin' and active` | Cross-tenant membership leak: a volunteer in A sees B's admins. |
| `get_transparency_report()` sums all `donations`/`expenses` | Public totals mix every mandal's money together. |
| `get_transparency_categories()` same | Same leak, per category. |
| `get_expense_categories()` → `select expense_categories from mandal_config` | Returns N rows for N mandals. Breaks outright, not just leaks. |
| `get_transparency_report` gates on `(select transparency_published from mandal_config)` | Subquery returns N rows → runtime error. |
| Route `/transparency` takes no mandal | No way to address one mandal's public report. |
| `mandal_assets_admin_write` policy checks only `is_admin()` | Any mandal's admin can overwrite another mandal's logo path. |

Facts that already work in our favour and need no change:

- `users.auth_user_id` is `unique` → one auth account maps to at most one `users` row. That
  *is* "one account, one mandal", for free.
- `users.email` is `unique` globally → the same email cannot be admin of two mandals, so
  `link_admin_account()` (which matches on email) stays unambiguous and needs no rewrite.
- `donations.client_idempotency_key` is a client-generated UUID, globally unique. Unaffected.
- `get_public_receipt(token)` takes an unguessable 16-byte token and returns one row. Already
  tenant-safe by construction.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Onboarding | Self-serve signup | Landing page already markets to many mandals. |
| Membership | One account, one mandal | `auth_user_id` unique makes it near-free. Second mandal → second email. |
| Signup guard | One mandal per verified email | Enforced in the DB, not the UI. Junk signups cost one row each. |
| Tenant key | `users.mandal_id`, via `app_mandal_id()` | Mirrors the existing `app_user_id()` helper. One place to reason about. |
| Receipt numbers | `mandals.next_receipt_no` counter in the insert trigger | Row lock serializes concurrent volunteers; gapless per mandal. |
| Public transparency URL | `/transparency/:slug` | Mandals paste this into WhatsApp groups; a UUID reads as a phishing link to a donor. One `text unique` column. |
| Connection pooling | Not doing it | There is no server. Browser → PostgREST; Supabase already fronts Postgres with Supavisor. ~10 mandals × few volunteers ≈ 50 users. Not a scale problem. |

## Data Model

### New: `mandals`

Replaces `mandal_config`. Same columns, real PK, plus the receipt counter.

```sql
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
```

`default_lang` is **not** added here — it belongs to Project B.

### Slug generation

The slug is derived from the mandal name at signup and **never changes afterwards**, even
when the name is edited in settings. A live public link that rots because someone fixed a
typo in their mandal name is worse than a slug that no longer matches.

```sql
create or replace function slugify(txt text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(txt), '[^a-z0-9]+', '-', 'g'))
$$;
```

**The Devanagari case is the normal case here, not an edge case.** A mandal named
`गणेश मंडळ` has no `[a-z0-9]` characters at all, so `slugify()` returns an empty string —
which fails the check constraint. Any mandal in this app's actual target market can hit
this. So `create_mandal()` must:

1. `base := slugify(mandal_name)`.
2. If `base` is empty or shorter than 2 characters, `base := 'mandal'`.
3. Try `base`; on unique violation try `base-2`, `base-3`, … until one succeeds. Bounded at
   50 attempts, then fall back to `base || '-' || substr(gen_random_uuid()::text, 1, 6)`.

The loop is inside `create_mandal()`'s transaction, so a concurrent signup racing for the
same slug loses the insert, catches 23505, and retries the next candidate rather than
producing a duplicate.

Truncate `base` to 40 characters before the suffix so the check constraint's length bound
can't be breached by a long mandal name.

### Changed: every other table

`users`, `donations`, `expenses`, `handovers` each gain:

```sql
mandal_id uuid not null references mandals(id)
```

Constraint changes on `donations`:

- Drop `default nextval('receipt_no_seq')`, then `drop sequence receipt_no_seq`.
- Drop the global `unique (receipt_no)`; add `unique (mandal_id, receipt_no)`.

Indexes:

```sql
create index users_mandal_id_idx      on users(mandal_id);
create index donations_mandal_id_idx  on donations(mandal_id, created_at desc);
create index expenses_mandal_id_idx   on expenses(mandal_id);
create index handovers_mandal_id_idx  on handovers(mandal_id);
```

### Migration & backfill (live data exists — nothing is dropped before it is copied)

Order matters:

1. `create table mandals (...)`.
2. `insert into mandals (name, slug, logo_url, signature_url, upi_vpa, upi_qr_url,
   receipt_prefix, expense_categories, bank_opening_paise, transparency_published)
   select name, coalesce(nullif(slugify(name), ''), 'mandal'), … from mandal_config;`
   — the existing mandal's name may be non-ASCII, so the same empty-slug fallback as
   `create_mandal()` applies. Only one row exists, so no dedup loop is needed here.
3. Add `mandal_id uuid references mandals(id)` (nullable) to the four tables.
4. `update <table> set mandal_id = (select id from mandals);` — safe: exactly one row exists
   at this point.
5. `alter table <table> alter column mandal_id set not null;`
6. `update mandals set next_receipt_no = coalesce((select max(receipt_no) + 1 from donations), 1);`
7. `alter table donations alter column receipt_no drop default; drop sequence receipt_no_seq;`
8. Swap the receipt_no unique constraint.
9. `drop view public_mandal_branding;` then `drop table mandal_config;`

If step 2 finds zero rows (a fresh database with no config), steps 4–6 are no-ops and the
first `create_mandal()` call seeds everything. Both paths must work.

## RLS

### New helper

```sql
create or replace function app_mandal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select mandal_id from users where auth_user_id = auth.uid()
$$;
```

### Policy rewrite

Every existing policy gains a mandal predicate. Admin policies become
`is_admin() and mandal_id = app_mandal_id()`. Volunteer policies keep their
`collected_by = app_user_id()` / `paid_by = …` / `volunteer_id = …` check **and** gain
`and mandal_id = app_mandal_id()`.

The volunteer checks are already transitively tenant-safe (a volunteer's own rows are by
definition in their own mandal). The mandal predicate goes on anyway: transitive safety is
an invariant that holds until someone edits a policy, and this is the file where a mistake
leaks a donor list.

`mandals` replaces `mandal_config`'s policies, scoped to `id = app_mandal_id()`:

```sql
create policy mandals_admin_select on mandals for select using (is_admin() and id = app_mandal_id());
create policy mandals_admin_update on mandals for update using (is_admin() and id = app_mandal_id())
                                                    with check (is_admin() and id = app_mandal_id());
```

No `insert` policy on `mandals` — mandals are created **only** through `create_mandal()`
(SECURITY DEFINER). No `delete` policy anywhere, preserving the existing no-hard-delete rule.

`users_self_select` (`auth_user_id = auth.uid()`) stays as-is: it matches exactly one row,
the caller's own, and is what bootstraps `app_mandal_id()`.

### Storage path scoping

`mandal_assets_admin_write` / `_update` gain a folder check so an admin can only write under
their own mandal's prefix:

```sql
(storage.foldername(name))[1] = app_mandal_id()::text
```

Project B moves uploads to Cloudinary, but A must not ship a window where any admin can
overwrite another mandal's logo.

## Server-side stamping (trigger)

`enforce_insert_defaults()` becomes `security definer` and gains **one new job: stamping
`mandal_id`**.

```sql
new.mandal_id := app_mandal_id();
```

This is the same rule SPEC.md already applies to `collected_by` — *"stamped with the acting
user's id from the session — never user-supplied"*. A compromised or buggy client cannot
insert into another mandal's books, regardless of what RLS says.

Receipt allocation, in the same trigger, for `donations` only:

```sql
update mandals
   set next_receipt_no = next_receipt_no + 1
 where id = new.mandal_id
 returning next_receipt_no - 1 into new.receipt_no;
```

`security definer` is **required** here: volunteers have no update policy on `mandals`, and
must not get one. The `update … returning` takes a row lock, so two volunteers inserting
concurrently serialize on that mandal's row and receive distinct, gapless numbers. Different
mandals lock different rows and never contend.

`forbid_financial_edit()` gains `mandal_id` to the guarded column list on all three financial
tables — re-published in full, since the existing triggers reference it by name.

## RPC changes

| RPC | Change |
|---|---|
| `create_mandal(mandal_name, admin_name)` | **New.** See below. |
| `list_admins()` | Add `and mandal_id = app_mandal_id()`. |
| `get_expense_categories()` | Add `where id = app_mandal_id()`. |
| `get_transparency_report(mandal_slug text)` | Resolves the slug to a mandal, filters both sums by it; gate becomes `published or (is_admin() and app_mandal_id() = <resolved id>)`. Unknown slug returns zero rows — same shape as "not published", so it leaks nothing about which slugs exist. |
| `get_transparency_categories(mandal_slug text)` | Same treatment. |
| `get_public_receipt(token)` | Drop the `public_mandal_branding` view; return the mandal's `name`, `logo_url`, `signature_url`, `receipt_prefix` joined onto the receipt row. |
| `link_admin_account()` | **Unchanged** — `users.email` is globally unique, so the email match is unambiguous. |
| `redeem_invite(token)` | **Unchanged** — `invite_token` is globally unique and the row already carries its `mandal_id`. |

The transparency admin-preview gate is `is_admin() and app_mandal_id() = mandal`, not bare
`is_admin()`. Bare `is_admin()` would let any mandal's admin preview any other mandal's
unpublished totals.

`get_public_receipt` folding in branding also drops `ReceiptPage` from two round trips to
one, since `getPublicBranding()` disappears.

Every new/changed function keeps the established
`revoke execute … from public; grant execute … to <role>` pattern — Postgres grants EXECUTE
to PUBLIC on creation, which the `list_admins()` migration already caught once.

### `create_mandal(mandal_name text, admin_name text) returns uuid`

`security definer`. Guards, in order:

1. `auth.uid() is null` → `not authenticated`.
2. `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)` → reject. Volunteer sessions
   are anonymous (`signInAnonymously()`); they must never create a mandal.
3. No email on the auth user → reject. Magic link is what proves the email is real.
4. `exists (select 1 from users where auth_user_id = auth.uid())` → `this account already
   belongs to a mandal`. **This is the one-mandal-per-email cap**, in the database.

Then, atomically: insert the `mandals` row, insert its first `users` row
(`role='admin'`, `auth_user_id=auth.uid()`, `email` from `auth.users`), return the id.

Edge case to handle explicitly: if the email was already invited as an admin of another
mandal, the `users.email` unique constraint raises 23505. Map that to a clear message —
"this email was already invited to a mandal; open your invite link instead" — not a raw
Postgres error.

## Screens

**New — `/signup`:** mandal name + your name, behind a magic link. Flow: enter email →
magic link → return authenticated → form → `create_mandal()` → `/admin`. The landing page
CTA points here.

**Changed:**

- `AuthProvider` — after `link_admin_account()`, a signed-in user with **no** `users` row is
  now a legitimate state (someone who authed but hasn't created their mandal). Route them to
  `/signup` instead of treating it as "no role". Today every guard reads that as no-role.
- `RequireRole` — unchanged in shape; the no-role → `/signup` redirect lives with the router.
- `MandalConfig` — reads/writes `mandals` (scoped by RLS) instead of the `mandal_config`
  singleton.
- `PublicTransparency` — route becomes `/transparency/:slug`, passes it to both RPCs.
- `AdminTransparency` — passes its own mandal's slug, and shows the shareable public link so
  an admin can copy it into a WhatsApp group. That link is the entire reason for the slug;
  a slug with no visible copy affordance is a column nobody uses.
- `src/lib/db/config.ts` — `getMandalConfig()` selects from `mandals`; `updateMandalConfig()`
  currently filters `.eq('id', true)` (the singleton key) and must filter by the caller's
  mandal id instead. RLS already scopes the row, so the filter is defence in depth, not the
  guard.
- `src/lib/db/transparency.ts`, `src/lib/db/receipt.ts` — follow the RPC signature changes.
  `getPublicBranding()` is deleted.
- `src/lib/db/ledger.ts` — reads `bank_opening_paise` via `getMandalConfig()`; follows the
  rename, no logic change.

**Unchanged:** collection form, pending send, cash-in-hand, handovers, expenses, volunteer
invites, admin invites. They all address rows through RLS and the session user, so mandal
scoping is invisible to them. This is the payoff of the tenant key living in one helper.
Verified by grep: no volunteer-facing path reads mandal branding, so no volunteer screen
needs a new query.

## Testing

**The gate: new assertion blocks in `supabase/verify-local.sh`.** This project already has
the right tool and it is not Vitest. `verify-local.sh` spins up a throwaway Postgres cluster,
stubs `auth`/`storage`, applies every migration, and asserts RLS with real
`set role authenticated; set request.jwt.claim.sub = …` sessions. The Vitest suite mocks the
Supabase client entirely, so it can prove a query's *shape* but can never prove a *policy* —
tenant isolation is a policy property. It goes in `verify-local.sh`.

The script's `auth` stub defines `auth.uid()` but **not** `auth.jwt()`, which
`create_mandal()` needs for its anonymous-session guard. The stub gains it.

Seeds two mandals, each with an admin and a volunteer and a donation, then asserts from
mandal A's admin session:

- `donations`, `expenses`, `handovers`, `users` — zero rows from B.
- `list_admins()` — B's admins absent.
- `get_transparency_report(B.id)` / `get_transparency_categories(B.id)` — zero rows while B
  is unpublished, even though the caller is an admin.
- `mandals` — cannot select or update B's row.
- Direct insert with `mandal_id: B.id` in the payload — lands in A (trigger overwrites it),
  never in B.

**Receipt numbering: also `verify-local.sh`.** Two mandals inserting donations interleaved
each get 1, 2, 3… of their own, and a client that forges `receipt_no` in the insert payload
gets the trigger's number instead. The script already has a forgery-override assertion for
`receipt_no`/`public_token` to model this on.

**Regression:** `reconcile.ts` and `money.ts` unit tests must stay green and stay at 100% —
they take a ledger and are tenant-agnostic by design, so they should need no edits. If they
need edits, something is wrong with the migration.

**Tests that will break at typecheck and must be updated** (they reference types that this
migration removes — `Tables<'mandal_config'>` and `Tables<'public_mandal_branding'>`):
`tests/config.test.ts`, `tests/MandalConfig.test.tsx`, `tests/AdminTransparency.test.tsx`,
`tests/receipt.test.ts`, `tests/ReceiptPage.test.tsx`. These are mechanical renames plus
dropping the `getPublicBranding` cases, but they are not optional — `npm run typecheck` fails
until they are done, and `db:types` must be regenerated before they can be fixed.

**E2E:** existing Playwright specs must pass unchanged against a single seeded mandal, plus
one new spec for signup → create mandal → invite volunteer → volunteer collects → receipt.

## Rollout

The migration is destructive to `mandal_config` (dropped in step 9). Before applying to the
live project: take a snapshot, apply to a local stack first, verify the isolation test, then
`supabase db push`. Then `npm run db:types` to regenerate `database.types.ts`.

Existing volunteer/admin sessions survive — `auth_user_id` links are untouched and every
existing row backfills into the one existing mandal.

## Boundaries

- **Always:** stamp `mandal_id` server-side in the trigger, never from the client; scope
  every new RLS policy and every new SECURITY DEFINER RPC by `app_mandal_id()`;
  `revoke execute from public` before granting.
- **Ask first:** any change to the reconciliation identity; any new `insert` policy on
  `mandals`; broadening `users` RLS beyond self + same-mandal-admin.
- **Never:** let a client supply `mandal_id`; expose an RPC that takes a mandal id and
  returns unpublished or donor-level data without an `app_mandal_id()` check; hard-delete a
  financial row.

## Out of scope

Deferred deliberately, with the trigger for revisiting each:

- **Connection pooling** — no server exists to pool from. Add when one does.
- **Multi-language receipts, Cloudinary, receipt redesign** — Project B.
- **Receipt template editor** — user called it future work. Add when a mandal asks.
- **One account in many mandals** — needs a memberships table, a mandal switcher, and an
  "active mandal" in every RLS helper. Add when someone actually runs two mandals.
- **Admin-editable slugs** — generated once at signup, immutable after. Add when a mandal
  asks, and only with a redirect story for the old link.
- **Superadmin / cross-mandal console** — nothing needs it yet.
- **Mandal deletion / offboarding** — no story yet; no-hard-delete makes it a soft-flag
  problem when it arrives.

## Success Criteria

1. Two mandals exist; each admin's ledger shows only their own donations, expenses,
   handovers, volunteers.
2. Each mandal's receipt numbers run 1, 2, 3… independently, with no gaps and no overlap.
3. A client that forges `mandal_id` in an insert payload writes to its own mandal anyway.
4. Signup: email → magic link → mandal name → admin dashboard, with no manual DB work.
5. A second signup from the same email is refused by the database with a clear message.
6. An anonymous (volunteer) session cannot call `create_mandal()`.
7. Mandal A's admin cannot preview mandal B's unpublished transparency report.
8. `/transparency/:slug` shows only that mandal's totals; `/r/:token` shows that receipt's
   own mandal branding.
9. A mandal named entirely in Devanagari gets a valid, unique, non-empty slug at signup, and
   two mandals with the same name get different slugs.
10. `tenant-isolation.test.ts` passes; `reconcile.ts` / `money.ts` stay at 100% coverage.
11. Existing volunteer and admin sessions keep working across the migration.
