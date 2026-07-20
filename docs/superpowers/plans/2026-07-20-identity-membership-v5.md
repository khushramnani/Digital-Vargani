# Identity, Membership & Onboarding (v5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the anonymous-session volunteer model and the split admins/volunteers screens with one system: real identity (Google/email) for everyone, a three-role membership model (owner/admin/volunteer), a single `invites` table + RPC flow used by both admin and volunteer invites, one Manage Members screen, and an onboarding flow with no dead ends.

**Architecture:** Two new migrations (schema, then RPCs) replace the old `redeem_invite`/`link_admin_account`/`reissue_invite` flow with `invites` + `create_invite`/`invite_preview`/`accept_invite`/`revoke_invite`/`resend_invite` + membership RPCs (`set_member_role`, `transfer_ownership`, `deactivate_member`, `reactivate_member`). `is_admin()` grows to cover `owner`, so every existing donations/expenses/handovers/mandal RLS policy needs zero edits. On the frontend, `/join/:token` (replacing `/invite/:token`) and a small shared `AuthMethods` component (Google + email, parameterized redirect) become the one signup surface for admins and volunteers alike; `/admin/members` (replacing `/admin/volunteers` + `/admin/admins`) is the one membership screen.

**Tech Stack:** Postgres/Supabase (SQL migrations, SECURITY DEFINER RPCs, RLS), React + TypeScript + react-router-dom, Vitest + Testing Library, the project's existing `supabase/verify-local.sh` throwaway-Postgres harness (not Docker/`supabase start` — this machine has no Docker).

## Global Constraints

- No new dependencies. Everything below is plain SQL, existing React/Tailwind patterns already in the repo, and the two Supabase Auth calls (`linkIdentity`, `updateUser`) already exposed by `@supabase/supabase-js@^2.110.4`.
- Every new/changed RPC is `SECURITY DEFINER` with `search_path` pinned, `revoke ... from public`, then an explicit `grant ... to anon|authenticated` — the pattern every existing RPC in this schema follows. Match it exactly.
- Every RPC-level authorization decision (role checks, tenant scoping) must have a harness assertion in `supabase/verify-local.sh` proving both the allow and the deny path — this schema has no other test coverage for RLS/RPC security.
- `npm run verify` ( = typecheck + vitest + `test:rls` + build) must stay green after every task that touches code the build/tests can see. `npm run test:rls` specifically requires local `pg_ctl`/`initdb`/`psql` on PATH (see `supabase/verify-local.sh` header) — already the case in this environment per prior sessions.
- Copy lives in `src/lib/strings.ts` only (existing repo rule) — never inline a user-facing string in a component.
- The project is linked to a live Supabase project (`rwcodlxouxilukiknydo`, confirmed via `supabase migration list`, all 27 existing migrations already applied to prod). Use the `supabase` CLI directly (already authenticated/linked) for `db push` / `gen types`; no MCP needed.

---

## Decisions made while turning the spec into code (read before starting)

The architecture doc (`docs/architecture-v5-identity-membership.md`) is a design spec, not code, and a few of its details only resolve once you look at the actual schema/components. These are settled — implement them as stated, don't re-derive:

1. **No dual invite system during a "transition window".** The spec's migration-plan step 5 describes a phased rollout over days. This plan ships the whole thing in one pass instead, which makes most of that phasing unnecessary: `redeem_invite`/`link_admin_account`/`reissue_invite` and `users.invite_token` are dropped outright in Task 1/2, not kept alongside the new system. This is safe because **already-redeemed** volunteers (the ones actually depending on continuity) never call those RPCs again — their `users.auth_user_id` already points at a real (if anonymous) `auth.users` row, and nothing in this plan touches that row or that binding. The only piece of the transition that's genuinely still needed — because it's for people, not code — is Task 14's dismissible "secure your account" banner, so an already-signed-in anonymous volunteer can upgrade in place.
2. **Never-redeemed old invites are abandoned, not migrated.** Any `users` row with `auth_user_id is null` at migration time (an old-style pending admin or volunteer who never completed sign-in) is deleted in Task 1 — provided it isn't referenced by any financial row (Task 1's DELETE checks this directly, rather than assuming it from `auth_user_id is null` alone: `20260717150000_demo_mandal.sql` seeds two intentionally-unauthenticatable `users` rows that ARE referenced by `donations`/`expenses` via direct migration-time INSERT, which the naive assumption would have tried to delete and failed on a foreign-key violation — caught during Task 1's implementation, not guessed at here). A genuinely-pending row has no equivalent in the new model; whoever held that link gets a fresh one from Manage Members, exactly as the spec's own migration-plan step 5 already prescribes for locked-out volunteers.
3. **`create_mandal`'s two "already belongs to a mandal" guards are removed, not kept.** The spec lists global `users.email` uniqueness (**"one person can never belong to two mandals"**) as one of the named reasons the current model must go. `create_mandal` currently enforces exactly that invariant in application code (`auth_user_id already exists` / `email already exists` → reject). Task 2 removes both checks — a real authenticated user can found a new mandal regardless of memberships elsewhere. What actually prevents a *duplicate* membership is the new `unique(mandal_id, auth_user_id)` / `unique(mandal_id, email)` constraints from Task 1, which are correctly scoped per-mandal instead of globally.
4. **One membership row resolves per session, even though a person can now hold several — client AND server, with the same tie-break.** `AuthProvider.fetchAppUser` currently does `.eq('auth_user_id', id).maybeSingle()`, which **throws** the moment the same auth identity has two `users` rows (now possible). Task 8 changes it to order by `created_at desc` (then `id desc` as a tiebreaker) and take the first row — your most-recently-joined mandal is your active session context. There is no mandal-switcher UI in the spec's flows, so none is built here; if that's ever needed, it's new scope, not part of this plan.

   The same ambiguity exists **server-side** in `app_user_id()`/`app_user_role()`/`app_mandal_id()` (defined in `20260719120000_audit_v2_features.sql`, pre-dating this plan) — each is a scalar-returning `select ... from users where auth_user_id = auth.uid() and active` with no `ORDER BY`/`LIMIT`. Before this plan, `auth_user_id` was globally unique, so "more than one row" was structurally impossible and this was never a bug. Task 1 makes `auth_user_id` unique only per-mandal, and Task 2's `create_mandal`/`accept_invite` are what actually let an identity accumulate a second row — which makes a *pre-existing* latent gap live: with more than one matching row, Postgres silently returns an arbitrary one (confirmed empirically during Task 2's review), so a session's tenant scope and role could resolve non-deterministically among a caller's own mandals on every RPC call. This can't cross into a mandal the caller has no membership in, but it can misapply owner/admin authority to the wrong one of the caller's own mandals unpredictably. Task 2's migration therefore also republishes all three functions with the identical `order by created_at desc, id desc limit 1` tie-break the client uses, so server and client always agree on which mandal a session is acting in.
5. **`transparency_visibility`/`hide_president_contact`/donor-data columns etc. are untouched.** This plan only touches `users`, adds `invites`, and touches the handful of RPCs/components named below. Every other v3/v4 feature is out of scope.
6. **"Delete mandal" is explicitly NOT built.** The spec's permission matrix lists "delete mandal" as an owner-only capability, but no RPC, no confirmation copy, and no flow for it appears anywhere else in the document — there's nothing to implement from. `transfer_ownership` (which *is* fully specified) is built. Deleting a mandal is flagged here as a real gap in the spec, left for a future pass once it's actually specified (what happens to donations? receipts already handed to donors? the public transparency URL?).
7. **`enable_anonymous_sign_ins` turning off is safe for already-signed-in volunteers.** That project setting only gates *new* `signInAnonymously()` calls; it does not invalidate existing anonymous `auth.users` rows or block their session refresh. Since no v5 UI path calls `signInAnonymously()` anymore, Task 19 turns it off (local config now, prod dashboard as a manual follow-up) without needing to wait for a "no anon sessions remain" checkpoint.

---

## Task 1: Schema — owner role, invites table, per-mandal uniqueness

**Files:**
- Create: `supabase/migrations/20260720120000_identity_owner_and_invites_schema.sql`

**Interfaces:**
- Produces: `is_owner() returns boolean`, redefined `is_admin() returns boolean` (now `role in ('owner','admin')`), table `invites` (columns: `id, mandal_id, role, name, email, phone, token_hash, invited_by, expires_at, consumed_at, revoked_at, created_at`), `users.role` check now allows `'owner'`, `users` unique constraints `users_mandal_auth_user_key (mandal_id, auth_user_id)` and `users_mandal_email_key (mandal_id, email)` replacing the old global-unique ones, unique index `users_one_owner_per_mandal` on `users(mandal_id) where role = 'owner'`, `purge_donations(scope)` now owner-gated.
- Consumes: existing `app_mandal_id()`, `app_user_id()`, `app_user_role()` (untouched — do not edit these).

- [ ] **Step 1: Write the migration**

```sql
-- v5 — Identity, Membership & Onboarding: schema. See
-- docs/architecture-v5-identity-membership.md.
--
-- Ordering is load-bearing: delete orphaned never-joined rows BEFORE the
-- owner backfill (an unlinked admin must never become the owner); widen the
-- role check BEFORE either UPDATE below can write 'owner' into it; backfill
-- the owner BEFORE the one-owner-per-mandal unique index exists (the index
-- must never observe two owners in one mandal, even transiently).

-- ── Orphaned never-joined rows ──────────────────────────────────────────
-- Under the old model, an admin row was inserted directly (admins.tsx) and
-- a volunteer row via invite_token, both waiting to be linked to a real
-- session on first login. Neither RPC that performed that link
-- (link_admin_account / redeem_invite) survives this migration (Task 2), so
-- any row that never got that far is unreachable going forward.
--
-- Safe to hard-delete PROVIDED nothing actually references it: every
-- APP-DRIVEN write requires a resolved session (app_user_id(), which reads
-- auth_user_id), so a genuinely-pending row is never referenced by
-- donations/expenses/handovers through the app. But
-- 20260717150000_demo_mandal.sql proves auth_user_id IS NULL alone isn't
-- sufficient to prove that: it seeds two users rows with auth_user_id/
-- email/invite_token all NULL by design, then references them directly via
-- raw INSERT (collected_by/paid_by), bypassing the app entirely. Scope the
-- delete by the real invariant — no financial row actually points at it —
-- not by the auth_user_id proxy.
delete from users u
where u.auth_user_id is null
  and not exists (select 1 from donations d where d.collected_by = u.id or d.voided_by = u.id)
  and not exists (select 1 from expenses  e where e.paid_by      = u.id or e.voided_by = u.id)
  and not exists (select 1 from handovers h where h.volunteer_id = u.id or h.received_by = u.id or h.voided_by = u.id);

-- ── Role: admin/volunteer -> owner/admin/volunteer ──────────────────────
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('owner', 'admin', 'volunteer'));

-- Backfill: the earliest-created active admin in each mandal becomes its
-- owner — in practice, create_mandal's own founding row (the delete above
-- already removed anyone who never actually logged in, so every remaining
-- admin candidate has a real auth_user_id).
update users u set role = 'owner'
  from (
    select distinct on (mandal_id) id
    from users
    where role = 'admin' and active
    order by mandal_id, created_at
  ) first_admin
  where u.id = first_admin.id;

create unique index users_one_owner_per_mandal on users(mandal_id) where role = 'owner';

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_user_role() = 'owner', false)
$$;

-- Every existing RLS policy on mandal_config/mandals/donations/expenses/
-- handovers/users is written against is_admin() — this one-line change is
-- what makes the owner able to do everything an admin could, everywhere,
-- with zero policy edits (the v5 spec's permission matrix table).
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_user_role() in ('owner', 'admin'), false)
$$;

-- ── One identity, many mandals ──────────────────────────────────────────
-- auth_user_id was globally UNIQUE, which is structurally "one person, one
-- mandal, ever" — the reason the whole rewrite exists. Same problem, same
-- fix, for email.
alter table users drop constraint users_auth_user_id_key;
alter table users add constraint users_mandal_auth_user_key unique (mandal_id, auth_user_id);

alter table users drop constraint users_email_key;
alter table users add constraint users_mandal_email_key unique (mandal_id, email);

-- invite_token's job moves to the invites table below.
alter table users drop column invite_token;

-- ── invites: invited-but-not-yet-joined people, separate from members ────
create table invites (
  id          uuid primary key default gen_random_uuid(),
  mandal_id   uuid not null references mandals(id),
  role        text not null check (role in ('admin', 'volunteer')), -- owners are never invited
  name        text not null,
  email       text,
  phone       text,
  token_hash  text not null unique, -- sha256 of the raw token; the raw token is never stored
  invited_by  uuid not null,
  expires_at  timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index invites_mandal_id_idx on invites(mandal_id);

-- No policies: every access path is a SECURITY DEFINER RPC (Task 2), same
-- shape as donors_summary/list_admins — so a raw client select returns
-- nothing, including token_hash, which must never be client-readable.
alter table invites enable row level security;

-- ── Danger zone moves to the owner ────────────────────────────────────────
create or replace function purge_donations(scope text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m      uuid := app_mandal_id();
  purged integer;
begin
  if not is_owner() or m is null then
    raise exception 'only the owner can purge donation history';
  end if;

  if scope = 'removed' then
    delete from donations where mandal_id = m and voided;
  elsif scope = 'all' then
    delete from donations where mandal_id = m;
  else
    raise exception 'invalid purge scope: %', scope;
  end if;

  get diagnostics purged = row_count;
  return purged;
end;
$$;
```

- [ ] **Step 2: Confirm the constraint names this migration drops actually exist under those names**

Run against the local harness cluster (fastest way to check — it's built from the exact same migration history as prod):

```bash
grep -n "role text not null check\|auth_user_id uuid unique\|email text unique" supabase/migrations/20260714111950_schema_and_rls.sql supabase/migrations/20260714121305_add_users_email.sql
```

These are inline (unnamed) constraints, so Postgres auto-names them `users_role_check`, `users_auth_user_id_key`, `users_email_key` — the names used above. If Task 1 Step 4's harness run fails with `constraint "..." does not exist`, run `\d users` against the local harness DB (`psql -h localhost -p 55432 -U postgres -d vm_verify` while `verify-local.sh` is mid-run, or add a temporary `\d users` line to the script) to get the real name and fix it here.

- [ ] **Step 3: This migration alone isn't independently testable — proceed to Task 2 (RPCs) before running the harness**

The harness applies every migration file in filename order before any assertion runs, so Task 1's schema and Task 2's RPCs are verified together in Task 4. Do not run `npm run test:rls` yet; the existing (untouched) redeem_invite/reissue_invite assertions later in `verify-local.sh` still reference the now-dropped `invite_token` column and will fail until Task 4 removes them.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720120000_identity_owner_and_invites_schema.sql
git commit -m "feat(db): v5 schema — owner role, per-mandal uniqueness, invites table"
```

---

## Task 2: RPCs — invite lifecycle + membership management

**Files:**
- Create: `supabase/migrations/20260720130000_invite_and_membership_rpcs.sql`

**Interfaces:**
- Consumes: `is_admin()`, `is_owner()`, `app_mandal_id()`, `app_user_id()` (Task 1), `invites` table (Task 1), `slugify()` (existing, from `20260717120000_multi_tenancy.sql`).
- Produces (all `SECURITY DEFINER`, granted to `authenticated` unless noted): `create_invite(role text, name text, email text default null, phone text default null) returns text` (raw token), `invite_preview(token text) returns table(mandal_name text, role text, invitee_name text)` (anon+authenticated), `accept_invite(token text) returns void` (authenticated only, rejects anonymous sessions), `revoke_invite(invite_id uuid) returns void`, `resend_invite(invite_id uuid) returns text` (new raw token), `list_pending_invites() returns table(id uuid, role text, name text, email text, phone text, expires_at timestamptz, created_at timestamptz)`, `set_member_role(member_id uuid, new_role text) returns void`, `transfer_ownership(member_id uuid) returns void`, `deactivate_member(member_id uuid) returns void`, `reactivate_member(member_id uuid) returns void`. Also replaces `create_mandal(...)` (same 6-arg signature, creator now gets `role = 'owner'`, the two obsolete "already belongs" guards removed — see Decision 3 above) and drops `link_admin_account()`, `redeem_invite(text)`, `reissue_invite(uuid)`.

- [ ] **Step 1: Write the migration**

```sql
-- v5 — Identity, Membership & Onboarding: invite + membership RPCs. See
-- docs/architecture-v5-identity-membership.md and the plan's "Decisions"
-- section for why create_mandal's old guards are gone, not ported.

-- ── create_mandal: creator becomes owner; multi-mandal membership allowed ─
-- Same signature as the v4 migration, so create-or-replace (no drop). The
-- "already has a mandal" / "email already invited elsewhere" guards are
-- gone — auth_user_id and email are now unique only WITHIN a mandal
-- (Task 1), which is what actually prevents a duplicate membership in the
-- SAME mandal; belonging to more than one mandal is now correct behaviour.
create or replace function create_mandal(
  mandal_name    text,
  admin_name     text,
  slug_hint      text default null,
  mandal_state   text default null,
  mandal_address text default null,
  mandal_city    text default null
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  my_email  text;
  base      text;
  candidate text;
  sfx       text;
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

  base := coalesce(
    nullif(slugify(slug_hint), ''),
    nullif(slugify(mandal_name), ''),
    'mandal'
  );

  if length(base) < 2 then
    base := base || '-mandal';
  end if;

  base := rtrim(left(base, 40), '-');
  candidate := base;

  loop
    begin
      insert into mandals (name, slug, state, address, city, president_name)
        values (
          mandal_name,
          candidate,
          nullif(btrim(mandal_state), ''),
          nullif(btrim(mandal_address), ''),
          nullif(btrim(mandal_city), ''),
          nullif(btrim(admin_name), '')
        )
      returning id into new_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      if suffix > 50 then
        sfx := '-' || substr(gen_random_uuid()::text, 1, 6);
      else
        sfx := '-' || suffix;
      end if;
      candidate := rtrim(left(base, 40 - length(sfx)), '-') || sfx;
    end;
  end loop;

  insert into users (mandal_id, name, email, role, auth_user_id, active)
  values (new_id, admin_name, my_email, 'owner', auth.uid(), true);

  return new_id;
end;
$$;

-- ── Old link-on-first-use RPCs: unreachable from any UI after this ───────
drop function link_admin_account();
drop function redeem_invite(text);
drop function reissue_invite(uuid);
drop function invite_preview(text); -- old 2-column signature; recreated below

-- ── Deterministic session resolution once multi-mandal membership is real ─
-- Task 1 widened auth_user_id from a globally-unique constraint to a
-- per-mandal-unique one, and create_mandal/accept_invite above are what
-- actually let one identity accumulate a second `users` row in a second
-- mandal. app_user_id()/app_user_role()/app_mandal_id() (defined in
-- 20260719120000_audit_v2_features.sql) had no ORDER BY/LIMIT because more
-- than one matching row was previously impossible — with one now possible,
-- Postgres silently returns an arbitrary row from a multi-row match, so a
-- session's tenant scope/role could resolve non-deterministically among a
-- caller's own mandals on every call. Republish all three with the same
-- deterministic tie-break the client uses (AuthProvider.fetchAppUser,
-- Task 8: most-recently-joined membership wins, `id` as a tiebreaker for a
-- created_at tie), so server and client always agree on which mandal a
-- session acts in.
create or replace function app_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid() and active
  order by created_at desc, id desc limit 1
$$;

create or replace function app_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from users where auth_user_id = auth.uid() and active
  order by created_at desc, id desc limit 1
$$;

create or replace function app_mandal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select mandal_id from users where auth_user_id = auth.uid() and active
  order by created_at desc, id desc limit 1
$$;

-- ── create_invite: owner invites admin+volunteer; admin invites volunteer ─
create or replace function create_invite(role text, name text, email text default null, phone text default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  raw_token text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can invite a member';
  end if;
  if role not in ('admin', 'volunteer') then
    raise exception 'invalid invite role';
  end if;
  if role = 'admin' and not is_owner() then
    raise exception 'only the owner can invite an admin';
  end if;
  if nullif(btrim(name), '') is null then
    raise exception 'name is required';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into invites (mandal_id, role, name, email, phone, token_hash, invited_by)
  values (
    app_mandal_id(), role, btrim(name),
    nullif(btrim(email), ''), nullif(btrim(phone), ''),
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    app_user_id()
  );

  return raw_token;
end;
$$;

revoke execute on function create_invite(text, text, text, text) from public;
grant execute on function create_invite(text, text, text, text) to authenticated;

-- ── invite_preview: names the mandal + role BEFORE any session exists ────
create or replace function invite_preview(token text)
returns table (mandal_name text, role text, invitee_name text)
language sql stable security definer set search_path = public, extensions as $$
  select m.name, i.role, i.name
  from invites i
  join mandals m on m.id = i.mandal_id
  where i.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and i.consumed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  limit 1
$$;

revoke execute on function invite_preview(text) from public;
grant execute on function invite_preview(text) to anon, authenticated;

-- ── accept_invite: a real (never anonymous) session joins the mandal ─────
create or replace function accept_invite(token text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  inv      invites%rowtype;
  my_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'invite links are accepted with a real Google or email account';
  end if;

  select * into inv from invites where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  if not found then
    raise exception 'invalid or expired invite link';
  end if;

  -- Idempotent: the same person re-opening a link they already used lands
  -- back on their existing membership instead of an error.
  if exists (select 1 from users where mandal_id = inv.mandal_id and auth_user_id = auth.uid()) then
    return;
  end if;

  if inv.revoked_at is not null or inv.consumed_at is not null then
    raise exception 'invalid or expired invite link';
  end if;
  if inv.expires_at <= now() then
    raise exception 'this invite link has expired';
  end if;

  if inv.email is not null then
    select email into my_email from auth.users where id = auth.uid();
    if my_email is null or lower(btrim(my_email)) <> lower(btrim(inv.email)) then
      raise exception 'this invite is locked to a different email address';
    end if;
  end if;

  insert into users (mandal_id, auth_user_id, role, name, email, phone, active)
  values (inv.mandal_id, auth.uid(), inv.role, inv.name, inv.email, inv.phone, true);

  update invites set consumed_at = now() where id = inv.id;
end;
$$;

revoke execute on function accept_invite(text) from public;
grant execute on function accept_invite(text) to authenticated;

-- ── revoke_invite / resend_invite ─────────────────────────────────────────
create or replace function revoke_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv_role text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can revoke an invite';
  end if;

  select role into inv_role from invites
   where id = invite_id and mandal_id = app_mandal_id()
     and consumed_at is null and revoked_at is null;
  if not found then
    raise exception 'invite not found';
  end if;
  if inv_role = 'admin' and not is_owner() then
    raise exception 'only the owner can revoke an admin invite';
  end if;

  update invites set revoked_at = now() where id = invite_id;
end;
$$;

revoke execute on function revoke_invite(uuid) from public;
grant execute on function revoke_invite(uuid) to authenticated;

create or replace function resend_invite(invite_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  old       invites%rowtype;
  raw_token text;
begin
  if not is_admin() then
    raise exception 'only an owner or admin can resend an invite';
  end if;

  select * into old from invites where id = invite_id and mandal_id = app_mandal_id();
  if not found then
    raise exception 'invite not found';
  end if;
  if old.consumed_at is not null then
    raise exception 'this invite has already been accepted';
  end if;
  if old.role = 'admin' and not is_owner() then
    raise exception 'only the owner can resend an admin invite';
  end if;

  update invites set revoked_at = coalesce(revoked_at, now()) where id = invite_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into invites (mandal_id, role, name, email, phone, token_hash, invited_by)
  values (old.mandal_id, old.role, old.name, old.email, old.phone,
          encode(extensions.digest(raw_token, 'sha256'), 'hex'), app_user_id());

  return raw_token;
end;
$$;

revoke execute on function resend_invite(uuid) from public;
grant execute on function resend_invite(uuid) to authenticated;

-- ── list_pending_invites: the "Invited" rows in Manage Members ───────────
create or replace function list_pending_invites()
returns table (id uuid, role text, name text, email text, phone text, expires_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, role, name, email, phone, expires_at, created_at
  from invites
  where mandal_id = app_mandal_id()
    and is_admin()
    and consumed_at is null
    and revoked_at is null
    and expires_at > now()
  order by created_at desc
$$;

revoke execute on function list_pending_invites() from public;
grant execute on function list_pending_invites() to authenticated;

-- ── set_member_role: owner only, volunteer<->admin only ──────────────────
create or replace function set_member_role(member_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    raise exception 'only the owner can change a member''s role';
  end if;
  if new_role not in ('admin', 'volunteer') then
    raise exception 'invalid role';
  end if;

  update users set role = new_role
   where id = member_id and mandal_id = app_mandal_id() and role in ('admin', 'volunteer');
  if not found then
    raise exception 'member not found, or is the owner';
  end if;
end;
$$;

revoke execute on function set_member_role(uuid, text) from public;
grant execute on function set_member_role(uuid, text) to authenticated;

-- ── transfer_ownership: owner only, target must be an active admin ───────
create or replace function transfer_ownership(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_user_id();
  m  uuid := app_mandal_id();
begin
  if not is_owner() then
    raise exception 'only the owner can transfer ownership';
  end if;
  if not exists (select 1 from users where id = member_id and mandal_id = m and role = 'admin' and active) then
    raise exception 'ownership can only be transferred to an active admin in your mandal';
  end if;

  -- Demote-then-promote, in that order: users_one_owner_per_mandal allows
  -- exactly one 'owner' row per mandal at any point this transaction is
  -- observable from outside, so the old owner must vacate the slot first.
  update users set role = 'admin' where id = me and mandal_id = m;
  update users set role = 'owner' where id = member_id and mandal_id = m;
end;
$$;

revoke execute on function transfer_ownership(uuid) from public;
grant execute on function transfer_ownership(uuid) to authenticated;

-- ── deactivate_member / reactivate_member ─────────────────────────────────
-- The role scope check (an admin may only touch a volunteer) is embedded
-- directly in each branch's own UPDATE ... WHERE, exactly like
-- set_member_role() above — not decided from a separately-SELECTed snapshot
-- and applied via a later, unfiltered UPDATE. Two statements (a snapshot
-- SELECT, then an UPDATE with no role predicate) would leave a real, if
-- narrow, TOCTOU window: a role change racing between them would make the
-- admin's authorization decision stale by the time the mutation runs.
create or replace function deactivate_member(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target users%rowtype;
begin
  select * into target from users where id = member_id and mandal_id = app_mandal_id();
  if not found then
    raise exception 'member not found';
  end if;

  if is_owner() then
    if target.id = app_user_id() then
      raise exception 'the owner cannot deactivate themself — transfer ownership first';
    end if;
    update users set active = false where id = member_id and mandal_id = app_mandal_id();
  elsif is_admin() then
    update users set active = false
     where id = member_id and mandal_id = app_mandal_id() and role = 'volunteer';
    if not found then
      raise exception 'an admin can only deactivate a volunteer';
    end if;
  else
    raise exception 'only an owner or admin can deactivate a member';
  end if;
end;
$$;

revoke execute on function deactivate_member(uuid) from public;
grant execute on function deactivate_member(uuid) to authenticated;

create or replace function reactivate_member(member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = member_id and mandal_id = app_mandal_id()) then
    raise exception 'member not found';
  end if;

  if is_owner() then
    update users set active = true where id = member_id and mandal_id = app_mandal_id();
  elsif is_admin() then
    update users set active = true
     where id = member_id and mandal_id = app_mandal_id() and role = 'volunteer';
    if not found then
      raise exception 'an admin can only reactivate a volunteer';
    end if;
  else
    raise exception 'only an owner or admin can reactivate a member';
  end if;
end;
$$;

revoke execute on function reactivate_member(uuid) from public;
grant execute on function reactivate_member(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260720130000_invite_and_membership_rpcs.sql
git commit -m "feat(db): v5 RPCs — invite lifecycle + membership management"
```

---

## Task 3: Fix seed.sql (drops `invite_token`, the column Task 1 removes)

**Files:**
- Modify: `supabase/seed.sql:19-24`

**Interfaces:** none new — purely removes a reference to a dropped column so the harness's `applying seed.sql` step doesn't fail.

- [ ] **Step 1: Edit the volunteer seed rows**

Replace:
```sql
insert into users (id, mandal_id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-000000000001',
   'Volunteer One', '9000000002', 'volunteer', 'seed-invite-token-vol1', true),
  ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-000000000001',
   'Volunteer Two', '9000000003', 'volunteer', 'seed-invite-token-vol2', true)
on conflict (id) do nothing;
```
with:
```sql
insert into users (id, mandal_id, name, phone, role, active) values
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-000000000001',
   'Volunteer One', '9000000002', 'volunteer', true),
  ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-000000000001',
   'Volunteer Two', '9000000003', 'volunteer', true)
on conflict (id) do nothing;
```

Also update line 21's `'Other Volunteer'` insert the same way (drop the `invite_token` column and its `'seed-invite-token-other'` value) — same fix, second occurrence in the file.

- [ ] **Step 2: Commit**

```bash
git add supabase/seed.sql
git commit -m "fix(db): seed.sql no longer references dropped users.invite_token"
```

---

## Task 4: Remove/repair harness assertions that reference dropped RPCs/columns

`supabase/verify-local.sh` is one 2037-line script; every migration is applied, then every assertion runs against the same database. Task 1/2 drop `invite_token`, `redeem_invite`, `link_admin_account`, `reissue_invite`, and change `invite_preview`'s return shape — every assertion touching those breaks. This task only removes/repairs; Task 5 adds new v5 coverage.

**Files:**
- Modify: `supabase/verify-local.sh` (five locations, listed below by their current `echo "== ... =="` banner so they're easy to find even if line numbers drift after earlier edits — edit top-to-bottom so later line numbers stay accurate).

- [ ] **Step 1: Delete the `link_admin_account()` + `redeem_invite()` assertion block**

Delete the entire block from `echo "== assertion: link_admin_account() links exactly the matching admin row =="` (currently line 164) through the end of its `SQL` heredoc, and the following `echo "== assertion: redeem_invite() links exactly the matching volunteer row and is single-use =="` block through *its* closing `SQL` heredoc (currently line 299). That's everything from the first banner to (and including) line 299's `SQL` in the file as it stands after Tasks 1–3. Nothing replaces it here — Task 5 adds the new invite-flow assertions in a new section near the end of the file.

- [ ] **Step 2: Fix the "deactivated users are fully locked out" fixture**

Find `echo "== assertion: new-issue #3 deactivated users are fully locked out ..."`. Its volunteer fixture insert currently reads:
```sql
insert into users (id, mandal_id, name, role, invite_token, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-000000000001',
   'Active Gate Volunteer', 'volunteer', 'active-gate-vol-token', 'aaaaaaaa-0000-0000-0000-0000000000f2', true);
```
Replace with:
```sql
insert into users (id, mandal_id, name, role, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-000000000001',
   'Active Gate Volunteer', 'volunteer', 'aaaaaaaa-0000-0000-0000-0000000000f2', true);
```
(Only the `invite_token`/`'active-gate-vol-token'` column and value are removed — everything else in that assertion block is unrelated to this migration and stays as-is.)

- [ ] **Step 3: Fix the demo-mandal "no authenticatable users" check**

Find `echo "== assertion: the demo mandal's report is publicly readable =="`. Its guard currently reads:
```sql
  ASSERT NOT EXISTS (
    SELECT 1 FROM users
     WHERE mandal_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
       AND (auth_user_id IS NOT NULL OR email IS NOT NULL OR invite_token IS NOT NULL)
  ), 'SECURITY HOLE: a demo mandal user has a way to authenticate';
```
Replace with:
```sql
  ASSERT NOT EXISTS (
    SELECT 1 FROM users
     WHERE mandal_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
       AND (auth_user_id IS NOT NULL OR email IS NOT NULL)
  ), 'SECURITY HOLE: a demo mandal user has a way to authenticate';
```

- [ ] **Step 4: Fix the "admin invites into own mandal by default" RLS test**

Find `echo "== assertion: TENANT ISOLATION — an admin invites into their OWN mandal by default =="`. This test's premise ("the real path settings/volunteers.tsx uses: it inserts name/phone/role/invite_token") is obsolete — nothing inserts into `users` directly anymore. The underlying property it proves (the `users_admin_insert` RLS policy still defaults/rejects on `mandal_id`) is untouched by this migration and still worth keeping — just drop the dead column from both raw inserts and update the comment:

Replace:
```sql
-- users has no insert trigger, so mandal_id comes from the column default
-- (app_mandal_id()). This is the real path settings/volunteers.tsx uses:
-- it inserts name/phone/role/invite_token and nothing else.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into users (name, phone, role, invite_token, active)
  values ('Invited By M2', '9000000099', 'volunteer', 'invite-default-test', true);
```
with:
```sql
-- No UI path inserts into `users` directly anymore (Task 2 moved that to
-- accept_invite, a SECURITY DEFINER RPC that bypasses RLS entirely) — this
-- now exercises the users_admin_insert RLS policy directly, proving it
-- still scopes/rejects by mandal_id on its own.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin

insert into users (name, phone, role, active)
  values ('Invited By M2', '9000000099', 'volunteer', true);
```
and replace:
```sql
    insert into users (mandal_id, name, role, invite_token, active)
      values ('11111111-1111-1111-1111-000000000001', 'Cross Mandal Invite', 'volunteer',
              'invite-cross-test', true);
```
with:
```sql
    insert into users (mandal_id, name, role, active)
      values ('11111111-1111-1111-1111-000000000001', 'Cross Mandal Invite', 'volunteer', true);
```

- [ ] **Step 5: Delete the `reissue_invite()` assertion block**

Delete the entire block from `echo "== assertion: reissue_invite() mints a fresh token and clears the old binding (audit #4) =="` through the end of its `SQL` heredoc. Nothing replaces it at this location — Task 5 covers `resend_invite` in the new section.

- [ ] **Step 6: Replace the old `invite_preview` assertion**

Find `echo "== assertion: invite_preview names the mandal for a live token and reveals nothing for a used one =="` and delete its entire block through the closing `SQL` heredoc (it tests the old 2-column `(mandal_name, volunteer_name)` signature against `users.invite_token`, both gone). Task 5 adds a replacement using the new `invites`-table-backed `invite_preview(token) returns (mandal_name, role, invitee_name)`.

- [ ] **Step 7: Confirm every remaining `invite_token` reference is gone**

```bash
grep -n "invite_token" supabase/verify-local.sh supabase/seed.sql
```
Expected: no output. If anything remains, it's a location this task's grep-based sweep (Steps 1–6, matched against the exact banners/snippets above) missed — read that block fully before editing it, same as Steps 2–4 did.

- [ ] **Step 8: Commit**

```bash
git add supabase/verify-local.sh
git commit -m "test(db): remove harness assertions for dropped v4 invite RPCs/columns"
```

---

## Task 5: Add harness assertions for every new v5 RPC

**Files:**
- Modify: `supabase/verify-local.sh` — insert one new section immediately before the final `echo "== all assertions passed =="` line (end of file).

**Interfaces:** exercises every RPC from Task 2 from both the allow and the deny side. Follows the file's existing fixture-ID convention: `00000000-0000-0000-0000-0000000000XX` for `users`/testing rows, `aaaaaaaa-0000-0000-0000-0000000000XX` for their paired `auth.users` row. This task uses fresh suffixes (`c1`–`c9`, `g1`–`g4`) not already used elsewhere in the file, so it can't collide with existing fixtures.

- [ ] **Step 1: Insert the new assertion section**

```sql
echo "== assertion: create_mandal() creator becomes owner, not admin =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'new-owner@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
set request.jwt.claims = '{"is_anonymous": false}';
select create_mandal('Owner Test Mandal', 'New Owner');
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1') = 'owner',
    'FAIL: create_mandal() creator should become owner, not admin';
  RAISE NOTICE 'PASS: create_mandal() creator becomes owner';
END $$;
SQL

echo "== assertion: users_one_owner_per_mandal — a second owner in the same mandal is rejected =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
DECLARE m uuid;
BEGIN
  SELECT mandal_id INTO m FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1';
  BEGIN
    INSERT INTO users (mandal_id, name, role, active) VALUES (m, 'Second Owner', 'owner', true);
    RAISE EXCEPTION 'SECURITY HOLE: a mandal accepted a second owner row';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: users_one_owner_per_mandal rejects a second owner (%)', SQLERRM;
  END;
END $$;
SQL

echo "== assertion: multi-mandal membership — the SAME identity can own/join a SECOND mandal =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- This is the exact scenario the old global unique(auth_user_id)/unique(email)
-- made impossible. c1 already owns "Owner Test Mandal" above; founding a
-- second mandal as the same identity must now succeed.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c1';
set request.jwt.claims = '{"is_anonymous": false}';
select create_mandal('Second Mandal For Same Owner', 'New Owner');
reset role;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c1';
  ASSERT n = 2, format('FAIL: same identity should now hold 2 memberships, saw %s', n);
  RAISE NOTICE 'PASS: one auth identity can belong to two different mandals';
END $$;
SQL

echo "== assertion: create_invite() — role gating (escalation attempts rejected) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal one's seed admin (001) is now its owner (Task 1 backfill); seed
-- volunteer 002 stays a volunteer throughout this file.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'New Volunteer Invite');
  ASSERT tok IS NOT NULL AND length(tok) > 0, 'FAIL: owner could not invite a volunteer';
  tok := create_invite('admin', 'New Admin Invite');
  ASSERT tok IS NOT NULL AND length(tok) > 0, 'FAIL: owner could not invite an admin';
  RAISE NOTICE 'PASS: owner can invite both volunteer and admin';
END $$;
reset role;

-- Give mandal one a real (non-owner) admin to test the escalation boundary.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c2', 'plain-admin@example.com');
insert into users (id, mandal_id, name, role, email, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-000000000001',
   'Plain Admin', 'admin', 'plain-admin@example.com', 'aaaaaaaa-0000-0000-0000-0000000000c2', true);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2'; -- plain admin, not owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Admin-Invited Volunteer');
  ASSERT tok IS NOT NULL, 'FAIL: an admin could not invite a volunteer';

  BEGIN
    PERFORM create_invite('admin', 'Escalation Attempt');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin invited another admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner can invite an admin%' THEN
      RAISE NOTICE 'PASS: create_invite() blocks an admin from inviting an admin (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- A volunteer cannot invite anyone at all.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- mandal one volunteer (seed)
DO $$
BEGIN
  BEGIN
    PERFORM create_invite('volunteer', 'Volunteer Escalation Attempt');
    RAISE EXCEPTION 'SECURITY HOLE: a volunteer created an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only an owner or admin%' THEN
      RAISE NOTICE 'PASS: create_invite() blocks a volunteer (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: invite_preview + accept_invite — the full join flow, and every rejection path =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- A live invite, minted the real way.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Join Flow Volunteer', 'join-flow@example.com');
  PERFORM set_config('verify.join_flow_token', tok, false);
END $$;
reset role;

-- invite_preview is anon-callable and names the mandal + role + invitee.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE m text; r text; n_name text;
BEGIN
  SELECT mandal_name, role, invitee_name INTO m, r, n_name
    FROM invite_preview(current_setting('verify.join_flow_token'));
  ASSERT m = 'Vinayak Mitra Mandal', format('FAIL: invite_preview mandal_name wrong, saw %s', m);
  ASSERT r = 'volunteer', format('FAIL: invite_preview role wrong, saw %s', r);
  ASSERT n_name = 'Join Flow Volunteer', format('FAIL: invite_preview invitee_name wrong, saw %s', n_name);
  RAISE NOTICE 'PASS: invite_preview names mandal + role + invitee for a live token';
END $$;
reset role;

-- An anonymous session cannot accept.
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-0000000000c3');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c3';
set request.jwt.claims = '{"is_anonymous": true}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: an anonymous session accepted an invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%real Google or email account%' THEN
      RAISE NOTICE 'PASS: accept_invite() rejects an anonymous session (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Wrong email: this invite is locked to join-flow@example.com.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c4', 'wrong-person@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c4';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: accept_invite ignored the email lock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%locked to a different email%' THEN
      RAISE NOTICE 'PASS: accept_invite() enforces the email lock (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- The real invitee accepts.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c5', 'join-flow@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c5';
set request.jwt.claims = '{"is_anonymous": false}';
select accept_invite(current_setting('verify.join_flow_token'));
reset role;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM users
     WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c5'
       AND role = 'volunteer' AND name = 'Join Flow Volunteer'
       AND mandal_id = '11111111-1111-1111-1111-000000000001'
  ), 'FAIL: accept_invite() did not create the expected membership';
  ASSERT (SELECT consumed_at FROM invites WHERE token_hash = encode(extensions.digest(current_setting('verify.join_flow_token'), 'sha256'), 'hex')) IS NOT NULL,
    'FAIL: accept_invite() did not mark the invite consumed';
  RAISE NOTICE 'PASS: accept_invite() creates the membership and marks the invite consumed';
END $$;

-- Idempotent: the same person re-opening the (now consumed) link is a no-op
-- success, not an error.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c5';
set request.jwt.claims = '{"is_anonymous": false}';
select accept_invite(current_setting('verify.join_flow_token'));
reset role;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000c5') = 1,
    'FAIL: re-accepting an already-used link by the same person should be a no-op, not a duplicate';
  RAISE NOTICE 'PASS: accept_invite() is idempotent for the same person';
END $$;

-- A DIFFERENT person cannot then reuse the same (consumed) token.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c6', null);
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c6';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.join_flow_token'));
    RAISE EXCEPTION 'SECURITY HOLE: a second, different person accepted an already-consumed invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: a consumed invite cannot be replayed by someone else (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Hash-mismatch / unknown token: invite_preview reveals nothing, accept fails.
set request.jwt.claim.sub = '';
set role anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM invite_preview('not-a-real-token');
  ASSERT n = 0, format('FAIL: an unknown token must preview nothing, saw %s rows', n);
END $$;
reset role;

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c7', 'someone@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c7';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite('not-a-real-token');
    RAISE EXCEPTION 'SECURITY HOLE: accept_invite succeeded on an unknown token';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: accept_invite() rejects an unknown/hash-mismatch token (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Revoked invite cannot be accepted.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Revoke Me');
  PERFORM set_config('verify.revoke_token', tok, false);
  PERFORM revoke_invite((SELECT id FROM invites WHERE token_hash = encode(extensions.digest(tok, 'sha256'), 'hex')));
END $$;
reset role;

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c8', 'revoked-target@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c8';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.revoke_token'));
    RAISE EXCEPTION 'SECURITY HOLE: a revoked invite was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invalid or expired%' THEN
      RAISE NOTICE 'PASS: a revoked invite cannot be accepted (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Expired invite cannot be accepted (backdate expires_at directly).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text;
BEGIN
  tok := create_invite('volunteer', 'Expire Me');
  PERFORM set_config('verify.expired_token', tok, false);
END $$;
reset role;
update invites set expires_at = now() - interval '1 minute'
 where token_hash = encode(extensions.digest(current_setting('verify.expired_token'), 'sha256'), 'hex');

insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000c9', 'expired-target@example.com');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c9';
set request.jwt.claims = '{"is_anonymous": false}';
DO $$
BEGIN
  BEGIN
    PERFORM accept_invite(current_setting('verify.expired_token'));
    RAISE EXCEPTION 'SECURITY HOLE: an expired invite was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%expired%' THEN
      RAISE NOTICE 'PASS: an expired invite cannot be accepted (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;
SQL

echo "== assertion: revoke_invite/resend_invite/list_pending_invites — tenant scoping + anon exposure =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Mandal two's admin must not be able to revoke/resend/see mandal one's invites.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
DO $$
DECLARE tok text; iid uuid;
BEGIN
  tok := create_invite('volunteer', 'Tenant Isolation Target');
  SELECT id INTO iid FROM invites WHERE token_hash = encode(extensions.digest(tok, 'sha256'), 'hex');
  PERFORM set_config('verify.tenant_invite_id', iid::text, false);
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
BEGIN
  BEGIN
    PERFORM revoke_invite(current_setting('verify.tenant_invite_id')::uuid);
    RAISE EXCEPTION 'SECURITY HOLE: mandal two revoked mandal one''s invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invite not found%' THEN
      RAISE NOTICE 'PASS: revoke_invite() is tenant-scoped (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM resend_invite(current_setting('verify.tenant_invite_id')::uuid);
    RAISE EXCEPTION 'SECURITY HOLE: mandal two resent mandal one''s invite';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%invite not found%' THEN
      RAISE NOTICE 'PASS: resend_invite() is tenant-scoped (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM list_pending_invites() WHERE id = current_setting('verify.tenant_invite_id')::uuid),
    'FAIL: list_pending_invites() leaked another mandal''s invite';
END $$;
reset role;

-- Owner CAN revoke their own mandal's invite.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select revoke_invite(current_setting('verify.tenant_invite_id')::uuid);
reset role;
DO $$
BEGIN
  ASSERT (SELECT revoked_at FROM invites WHERE id = current_setting('verify.tenant_invite_id')::uuid) IS NOT NULL,
    'FAIL: owner could not revoke their own mandal''s invite';
  RAISE NOTICE 'PASS: owner can revoke an invite in their own mandal';
END $$;

-- list_pending_invites is not exposed to anon.
set request.jwt.claim.sub = '';
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM list_pending_invites();
    RAISE EXCEPTION 'SECURITY HOLE: anon called list_pending_invites()';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: list_pending_invites() has no anon grant (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: set_member_role — owner only, volunteer<->admin only (role escalation blocked) =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001'; -- mandal one owner
select set_member_role('00000000-0000-0000-0000-000000000002', 'admin'); -- promote seed volunteer 002
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = 'admin',
    'FAIL: owner could not promote a volunteer to admin';
END $$;

-- A non-owner (the plain admin from the create_invite test) cannot change roles.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
DO $$
BEGIN
  BEGIN
    PERFORM set_member_role('00000000-0000-0000-0000-000000000002', 'volunteer');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin changed a member''s role';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner%' THEN
      RAISE NOTICE 'PASS: set_member_role() blocks a non-owner (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Demote 002 back to volunteer so it doesn't disturb any later assertion
-- in this file that still expects it to be a plain volunteer.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_member_role('00000000-0000-0000-0000-000000000002', 'volunteer');
reset role;
DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = 'volunteer',
    'FAIL: set_member_role() could not demote back to volunteer';
  RAISE NOTICE 'PASS: set_member_role() promotes/demotes volunteer<->admin, owner-gated';
END $$;
SQL

echo "== assertion: transfer_ownership — atomic swap, owner-only, target must be an active admin =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- A non-owner cannot transfer ownership to themself (escalation attempt).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2'; -- plain admin
DO $$
BEGIN
  BEGIN
    PERFORM transfer_ownership('00000000-0000-0000-0000-0000000000c2');
    RAISE EXCEPTION 'SECURITY HOLE: a non-owner admin transferred ownership to themself';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only the owner%' THEN
      RAISE NOTICE 'PASS: transfer_ownership() blocks a non-owner caller (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;
reset role;

-- Owner transfers to the plain admin (c2); the swap must be atomic.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select transfer_ownership('00000000-0000-0000-0000-0000000000c2');
reset role;

DO $$
BEGIN
  ASSERT (SELECT role FROM users WHERE id = '00000000-0000-0000-0000-0000000000c2') = 'owner',
    'FAIL: transfer_ownership() did not promote the target';
  ASSERT (SELECT role FROM users WHERE auth_user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'admin',
    'FAIL: transfer_ownership() did not demote the old owner';
  ASSERT (SELECT count(*) FROM users WHERE mandal_id = '11111111-1111-1111-1111-000000000001' AND role = 'owner') = 1,
    'FAIL: mandal one must have exactly one owner after transfer';
  RAISE NOTICE 'PASS: transfer_ownership() swaps roles atomically, exactly one owner survives';
END $$;

-- Transfer back so later assertions relying on aaaaaaaa-...-001 being the
-- owner (there are none after this point in the file, but this keeps the
-- fixture state predictable for anyone re-running a slice of this script).
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000c2';
select transfer_ownership('00000000-0000-0000-0000-000000000001'); -- fails: 001 is now 'admin', not active admin? it IS admin+active, so this succeeds.
reset role;
SQL

echo "== assertion: deactivate_member/reactivate_member — sole-owner self-protection, admin scope limits =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
-- Owner (back to aaaaaaaa-...-001 after the transfer-back above) cannot
-- deactivate themself while sole owner.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    PERFORM deactivate_member('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'SECURITY HOLE: the sole owner deactivated themself';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%cannot deactivate themself%' THEN
      RAISE NOTICE 'PASS: the owner cannot deactivate themself (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- Owner CAN deactivate an admin.
select deactivate_member('00000000-0000-0000-0000-0000000000c2');
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-0000000000c2') = false,
    'FAIL: owner could not deactivate an admin';
END $$;

-- An admin cannot deactivate another admin (scope: volunteers only). Use a
-- fresh active admin for this check.
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000g1', 'scope-admin-1@example.com');
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000g2', 'scope-admin-2@example.com');
insert into users (id, mandal_id, name, role, email, auth_user_id, active) values
  ('00000000-0000-0000-0000-0000000000g1', '11111111-1111-1111-1111-000000000001',
   'Scope Admin One', 'admin', 'scope-admin-1@example.com', 'aaaaaaaa-0000-0000-0000-0000000000g1', true),
  ('00000000-0000-0000-0000-0000000000g2', '11111111-1111-1111-1111-000000000001',
   'Scope Admin Two', 'admin', 'scope-admin-2@example.com', 'aaaaaaaa-0000-0000-0000-0000000000g2', true);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000g1';
DO $$
BEGIN
  BEGIN
    PERFORM deactivate_member('00000000-0000-0000-0000-0000000000g2');
    RAISE EXCEPTION 'SECURITY HOLE: an admin deactivated another admin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%only deactivate a volunteer%' THEN
      RAISE NOTICE 'PASS: an admin cannot deactivate another admin (%)', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- ...but CAN deactivate/reactivate a volunteer.
  PERFORM deactivate_member('00000000-0000-0000-0000-000000000002'); -- seed volunteer, back to 'volunteer' from the prior test
END $$;
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = false,
    'FAIL: an admin could not deactivate a volunteer';
END $$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000g1';
select reactivate_member('00000000-0000-0000-0000-000000000002');
reset role;
DO $$
BEGIN
  ASSERT (SELECT active FROM users WHERE id = '00000000-0000-0000-0000-000000000002') = true,
    'FAIL: an admin could not reactivate a volunteer';
  RAISE NOTICE 'PASS: deactivate_member/reactivate_member respect owner-vs-admin scope, and sole-owner self-protection';
END $$;

-- Clean up this task's throwaway fixtures so later count-based assertions
-- (if this section is ever reordered before them) aren't affected.
delete from users where id in (
  '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000g1', '00000000-0000-0000-0000-0000000000g2'
);
SQL
```

- [ ] **Step 2: Run the full harness**

```bash
npm run test:rls
```
Expected: `PASS: all migration/trigger/RLS assertions held.` Every `RAISE NOTICE 'PASS: ...'` line and no `FAIL`/uncaught exception in the output. Fix and re-run until green — do not proceed with a red harness.

- [ ] **Step 3: Commit**

```bash
git add supabase/verify-local.sh
git commit -m "test(db): harness coverage for v5 invite lifecycle + membership RPCs"
```

---

## Task 6: Push to Supabase, regenerate types

**Files:**
- Modify: `src/lib/db/database.types.ts` (generated, not hand-edited)

- [ ] **Step 1: Push both new migrations to the live project**

```bash
supabase db push
```
Confirm the prompt lists exactly `20260720120000_identity_owner_and_invites_schema.sql` and `20260720130000_invite_and_membership_rpcs.sql`, then accept. This is a real production database — do not run this until Task 5's harness is fully green.

- [ ] **Step 2: Regenerate types**

```bash
npm run db:types
```

- [ ] **Step 3: Confirm the new RPCs/table appear**

```bash
grep -n "create_invite\|accept_invite\|invite_preview\|transfer_ownership\|invites:" src/lib/db/database.types.ts
```
Expected: matches for each. `invite_preview`'s `Returns` should now be a 3-column shape (`mandal_name`, `role`, `invitee_name`), not the old 2-column one.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/database.types.ts
git commit -m "chore(db): regenerate types for v5 schema/RPCs"
```

---

## Task 7: `src/lib/roles.ts` — the one `isAdminRole` check

**Files:**
- Create: `src/lib/roles.ts`

**Interfaces:**
- Produces: `export type Role = 'owner' | 'admin' | 'volunteer'`, `export function isAdminRole(role: string): boolean`, `export function isOwnerRole(role: string): boolean`.
- Consumed by: Tasks 8–15 (every place that used to write `role === 'admin'`).

- [ ] **Step 1: Write the file**

```ts
// One 'owner or admin' check, reused everywhere role gating used to write
// `role === 'admin'` — the exact string check every one of those call sites
// silently broke the moment 'owner' became a real third role. One function
// instead of `role === 'owner' || role === 'admin'` copy-pasted at each site.
export type Role = 'owner' | 'admin' | 'volunteer'

export function isAdminRole(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

export function isOwnerRole(role: string): boolean {
  return role === 'owner'
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat: add isAdminRole/isOwnerRole helper for the v5 owner role"
```

---

## Task 8: `AuthProvider.tsx` — drop `link_admin_account`, fix multi-mandal self-select

**Files:**
- Modify: `src/features/auth/AuthProvider.tsx:1-16` (the `fetchAppUser` helper) and `:56-66` (the `link_admin_account` call inside `resolve`)

**Interfaces:**
- Consumes: none new.
- Produces: `fetchAppUser` still resolves to `AppUser | null`, now deterministic even when the same `auth_user_id` has rows in more than one mandal (Decision 4).

- [ ] **Step 1: Fix `fetchAppUser` to tolerate more than one membership row**

Replace:
```ts
async function fetchAppUser(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabase.from('users').select('*').eq('auth_user_id', authUserId).maybeSingle()
  if (error) throw error
  return data ?? null
}
```
with:
```ts
// A person can now hold a membership in more than one mandal (v5) — .single()
// would throw the moment that's true for the signed-in identity. There's no
// mandal-switcher in this app yet, so the most-recently-joined membership is
// the session's active mandal, deterministically — the identical tie-break
// (created_at desc, id desc as a tiebreaker) that Task 2's migration gives
// app_user_id()/app_user_role()/app_mandal_id() server-side, so client and
// server always agree on which mandal a session acts in.
async function fetchAppUser(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}
```

- [ ] **Step 2: Remove the `link_admin_account` linking step**

Delete this whole block from inside `resolve()` (the RPC it calls no longer exists — v5 has no email-match auto-link; membership is created directly by `create_mandal`/`accept_invite`):
```ts
      // One-time linking step for the chicken-and-egg problem: a
      // freshly-authenticated admin's `users` row has no `auth_user_id` yet.
      // The RPC is idempotent server-side (WHERE auth_user_id is null) and a
      // no-op for a non-admin email, so awaiting it here just avoids racing
      // the appUser query below on first login rather than being required.
      try {
        await supabase.rpc('link_admin_account')
      } catch {
        // Non-fatal: a failed/no-op link just means appUser resolves to
        // null below, which every route guard already treats as "no role".
      }

```
(Leave the surrounding `try { const user = await fetchAppUser(...) } catch { ... }` block immediately after it untouched.)

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Run existing tests touching this file**

```bash
npx vitest run tests/InviteRedeem.test.tsx tests/RequireRole.test.tsx tests/Signup.test.tsx
```
These currently mock `rpc` generically and don't assert `link_admin_account` was called, so they should still pass unchanged at this point (Task 12 replaces `InviteRedeem.test.tsx` itself).

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/AuthProvider.tsx
git commit -m "fix(auth): drop link_admin_account (dropped RPC), handle multi-mandal self-select"
```

---

## Task 9: `RequireRole.tsx` + `router.tsx` — owner-aware route guards

**Files:**
- Modify: `src/features/auth/RequireRole.tsx:9` (the `Role` type)
- Modify: `src/app/router.tsx:42` and `:68,76,84` (route `role` props)

**Interfaces:**
- Consumes: `Role` type — switch its source to `src/lib/roles.ts` (Task 7) instead of the local redeclaration, so there's one definition.

- [ ] **Step 1: Widen `RequireRole`'s role type**

In `src/features/auth/RequireRole.tsx`, replace:
```ts
// users.role is a plain `text` column with a CHECK constraint (not a
// Postgres enum — see database.types.ts), so this union is asserted here
// for call-site DX rather than derived from the generated Row type.
type Role = 'admin' | 'volunteer'
```
with:
```ts
import type { Role } from '../../lib/roles'
```
(remove the now-redundant inline `type Role = ...` — move this `import` up alongside the file's other imports at the top, keeping the existing `import { useAuth } from './useAuth'` etc.)

No other logic in `RequireRole.tsx` changes — `allowedRoles.includes(appUser.role as Role)` already works for any role list passed in; only route definitions need to widen what they pass.

- [ ] **Step 2: Let the admin console route allow owner**

In `src/app/router.tsx`, replace:
```tsx
      <Route
        element={
          <RequireRole role="admin">
            <AdminLayout />
          </RequireRole>
        }
      >
```
with:
```tsx
      <Route
        element={
          <RequireRole role={['owner', 'admin']}>
            <AdminLayout />
          </RequireRole>
        }
      >
```

- [ ] **Step 3: Let the collect flow allow owner too**

Replace all three occurrences of `role={['admin', 'volunteer']}` (the `/collect`, `/collect/pending`, `/collect/history` routes) with `role={['owner', 'admin', 'volunteer']}`. Leave the three `role="volunteer"` routes (`/volunteer/expenses`, `/volunteer/handover`, `/volunteer/cash-in-hand`) untouched — they're a pre-existing, unrelated volunteer-only self-entry surface, out of scope for this rewrite.

- [ ] **Step 4: Typecheck + run RequireRole tests**

```bash
npm run typecheck
npx vitest run tests/RequireRole.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/RequireRole.tsx src/app/router.tsx
git commit -m "feat(auth): owner role can reach the admin console and collect flow"
```

---

## Task 10: `AuthMethods.tsx` (extracted) + `AdminLogin.tsx` rewrite

**Files:**
- Create: `src/features/auth/AuthMethods.tsx`
- Modify: `src/features/auth/AdminLogin.tsx` (full rewrite, shrinks substantially)
- Modify: `src/lib/strings.ts:51` (`auth.volunteerHint` copy — wrong under v5)

**Interfaces:**
- Produces: `export function AuthMethods({ redirectTo }: { redirectTo: string }): JSX.Element` — the Google button + email-magic-link form + "check your email" confirmation, taking the post-auth landing URL as a prop instead of hardcoding `/admin`.
- Consumed by: `AdminLogin.tsx` (this task) and `JoinInvite.tsx` (Task 12).

- [ ] **Step 1: Extract `AuthMethods.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'

const t = strings.auth

export type Status = 'idle' | 'sending' | 'sent' | 'error'

const inputCls =
  'rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20'

// The full-colour Google "G". Inline so the CSP-tight bundle carries no
// remote asset, and so it inherits nothing from the surrounding button.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

// The two real auth actions (Google OAuth / email magic link) — shared by
// AdminLogin (lands at /admin) and JoinInvite (lands back on the invite
// link itself, so accept_invite can run once a real session exists). Same
// component, different `redirectTo`.
//
// onStatusChange lets a caller react to the sent-confirmation state without
// lifting the whole form here: AdminLogin passes a footer to its outer
// AuthShell ("First time?" / "Collecting for a mandal?"), and that footer's
// copy ("sign in above") goes stale/misleading once the form is replaced by
// "check your email" — AdminLogin hides its footer exactly then. JoinInvite
// passes no footer, so it can ignore this prop entirely.
export function AuthMethods({
  redirectTo,
  onStatusChange,
}: {
  redirectTo: string
  onStatusChange?: (status: Status) => void
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  async function handleGoogle() {
    setGoogleBusy(true)
    setStatus('idle')
    setErrorMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    // On success the browser navigates away to Google; only an error path
    // returns control here.
    if (error) {
      setGoogleBusy(false)
      setStatus('error')
      setErrorMessage(t.googleError)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('sending')
    setErrorMessage(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl">✉️</div>
        <p className="text-[15px] leading-relaxed text-stone-600">
          {t.checkEmailSentTo} <span className="font-semibold text-stone-900">{email}</span>.
        </p>
        <p className="text-sm text-stone-500">{t.checkEmailHelp}</p>
        <button
          type="button"
          onClick={() => {
            setStatus('idle')
            setEmail('')
          }}
          className="mt-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          {t.backToLogin}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleBusy}
        className="flex items-center justify-center gap-2.5 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
      >
        <GoogleG />
        {googleBusy ? t.startingGoogle : t.continueWithGoogle}
      </button>

      <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-stone-400 uppercase">
        <span className="h-px flex-1 bg-stone-200" />
        {t.or}
        <span className="h-px flex-1 bg-stone-200" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="auth-email" className="text-sm font-semibold text-stone-600">
          {t.emailLabel}
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          placeholder={t.emailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputCls}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50"
        >
          {status === 'sending' ? t.sending : t.sendLink}
        </button>
      </form>

      {status === 'error' && errorMessage && (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `AdminLogin.tsx` to use it**

```tsx
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods, type Status } from './AuthMethods'
import { isAdminRole } from '../../lib/roles'

const t = strings.auth

export function AdminLogin() {
  const { loading, session, appUser } = useAuth()
  // Tracks AuthMethods' own status so the footer below can hide itself once
  // the form is replaced by "check your email" — the footer's "sign in
  // above" copy is stale/misleading once there's no form to sign in with
  // above it (a real regression an earlier version of this component had:
  // the two states used to render as separate AuthShells, one with a footer
  // and one without; collapsing to one AuthShell needs this to preserve
  // that behavior).
  const [authStatus, setAuthStatus] = useState<Status>('idle')

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 font-body text-stone-400">{t.loading}</div>
  }

  // Already signed in? Don't show a login form. Route by role so a volunteer
  // who lands here isn't bounced to /admin (which would send them straight
  // back — a loop). A session with no `users` row is a fresh account that
  // still has to create/join a mandal, so send it to onboarding.
  if (session) {
    if (appUser) return <Navigate to={isAdminRole(appUser.role) ? '/admin' : '/collect'} replace />
    return <Navigate to="/signup" replace />
  }

  return (
    <AuthShell
      title={t.loginTitle}
      subtitle={t.loginSubtitle}
      footer={
        authStatus === 'sent' ? undefined : (
          <div className="rounded-2xl border border-stone-200 bg-white/60 p-4 text-center">
            <p className="text-sm font-bold text-stone-800">{t.newHereTitle}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-stone-500">{t.newHere}</p>
            <p className="mt-3 border-t border-stone-200 pt-3 text-[13px] leading-relaxed text-stone-500">
              {t.volunteerHint}
            </p>
          </div>
        )
      }
    >
      <AuthMethods redirectTo={`${window.location.origin}/admin`} onStatusChange={setAuthStatus} />
    </AuthShell>
  )
}
```

- [ ] **Step 3: Fix the now-wrong `volunteerHint` copy**

In `src/lib/strings.ts`, replace:
```ts
    volunteerHint: 'Collecting for a mandal? Open the invite link your admin shared — volunteers need no login.',
```
with:
```ts
    volunteerHint: "Collecting for a mandal? Sign in the same way — Google or email — using the invite link your admin shared to join first.",
```

- [ ] **Step 4: Typecheck + build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/AuthMethods.tsx src/features/auth/AdminLogin.tsx src/lib/strings.ts
git commit -m "refactor(auth): extract AuthMethods (Google+email), fix volunteerHint copy for v5"
```

---

## Task 11: `src/lib/db/members.ts` — data-access layer

**Files:**
- Create: `src/lib/db/members.ts`

**Interfaces:**
- Produces: `fetchMembers(): Promise<Tables<'users'>[]>`, `fetchPendingInvites(): Promise<PendingInvite[]>`, `createInvite(role, name, email?, phone?): Promise<string>`, `revokeInvite(id): Promise<void>`, `resendInvite(id): Promise<string>`, `setMemberRole(id, role): Promise<void>`, `transferOwnership(id): Promise<void>`, `deactivateMember(id): Promise<void>`, `reactivateMember(id): Promise<void>`, `previewInvite(token): Promise<InvitePreview | null>`, `acceptInvite(token): Promise<void>`.
- Consumed by: Task 12 (`JoinInvite.tsx`), Task 15 (`members.tsx`).

- [ ] **Step 1: Write the file**

```ts
// Data access for the v5 membership model: the Manage Members screen (list
// + invite + per-row actions) and the /join/:token flow both live here,
// same as users.ts's fetchMandalUserNames — one file per data concern.
//
// Every function here wraps a failure in a real `Error` (not the raw
// PostgrestError supabase-js returns), same reasoning as mandals.ts's
// createMandal: a PostgrestError is a plain object, not an Error instance,
// so `err instanceof Error ? err.message : String(err)` — the pattern every
// caller of this file uses (members.tsx, JoinInvite.tsx) — would silently
// degrade to the useless "[object Object]" on a raw throw. (Some older
// files in this codebase — users.ts, void.ts — throw raw and happen to feed
// callers that use the same instanceof-Error pattern anyway, which is a
// pre-existing latent bug there, not a convention worth repeating here.)
import { supabase } from './client'
import type { Tables } from './database.types'

export type Member = Tables<'users'>

export type PendingInvite = {
  id: string
  role: string
  name: string
  email: string | null
  phone: string | null
  expiresAt: string
  createdAt: string
}

export type InvitePreview = { mandalName: string; role: string; invitee: string }

// users_admin_select RLS already returns every member (owner+admin+
// volunteer, active+inactive) in the caller's own mandal — no RPC needed,
// same as admins.tsx/volunteers.tsx's old fetches.
export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc('list_pending_invites')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }))
}

export async function createInvite(role: 'admin' | 'volunteer', name: string, email?: string, phone?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', { role, name, email, phone })
  if (error) throw new Error(error.message)
  return data
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { invite_id: id })
  if (error) throw new Error(error.message)
}

export async function resendInvite(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('resend_invite', { invite_id: id })
  if (error) throw new Error(error.message)
  return data
}

export async function setMemberRole(id: string, role: 'admin' | 'volunteer'): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { member_id: id, new_role: role })
  if (error) throw new Error(error.message)
}

export async function transferOwnership(id: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_ownership', { member_id: id })
  if (error) throw new Error(error.message)
}

export async function deactivateMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('deactivate_member', { member_id: id })
  if (error) throw new Error(error.message)
}

export async function reactivateMember(id: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_member', { member_id: id })
  if (error) throw new Error(error.message)
}

// Public (pre-session) — used by /join/:token before any auth has happened.
// Checks `error` explicitly (unlike a bare `data?.[0]` read) so a genuine RPC
// failure (network blip, unexpected server exception) throws instead of
// being indistinguishable from "this token doesn't resolve to a live
// invite" — the caller (JoinInvite) still folds both into the same
// invalid-link UI, but that's its choice to make, not this function's.
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('invite_preview', { token })
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return row ? { mandalName: row.mandal_name, role: row.role, invitee: row.invitee_name } : null
}

export async function acceptInvite(token: string): Promise<void> {
  const { error } = await supabase.rpc('accept_invite', { token })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/members.ts
git commit -m "feat: add members.ts data layer for invites + membership management"
```

---

## Task 12: `JoinInvite.tsx` (replaces `InviteRedeem.tsx`) + route wiring

**Files:**
- Create: `src/features/auth/JoinInvite.tsx`
- Delete: `src/features/auth/InviteRedeem.tsx`
- Delete: `tests/InviteRedeem.test.tsx`
- Create: `tests/JoinInvite.test.tsx`
- Modify: `src/app/router.tsx` (route swap)
- Modify: `src/lib/strings.ts` (`auth` additions, remove now-unused `invite*` keys the old component owned)

**Interfaces:**
- Consumes: `previewInvite`, `acceptInvite` (Task 11), `AuthMethods` (Task 10), `isAdminRole` (Task 7).
- Produces: route `/join/:token`; `/invite/:token` becomes a redirect to `/join/:token` (old links from before this migration land somewhere real, even though the underlying token — an old `invite_token`, never migrated into `invites` — will now show "invalid or expired", per Decision 2).

- [ ] **Step 1: Write `JoinInvite.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './useAuth'
import { previewInvite, acceptInvite, type InvitePreview } from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { AuthShell } from '../../components/AuthShell'
import { AuthMethods } from './AuthMethods'
import { isAdminRole } from '../../lib/roles'

const t = strings.auth

type Status = 'checking' | 'invalid' | 'ready' | 'accepting' | 'accept-error'

// Public route (/join/:token) — the one way anyone, admin or volunteer,
// gets a membership under v5. No signInAnonymously anywhere: the invitee
// signs in with a real Google/email identity (AuthMethods), then
// accept_invite() links that identity to the invited row.
//
// A real (non-anonymous) session already present — whether they just
// finished the Google/email round trip back to this same URL, or they were
// already signed in from browsing the app earlier — skips straight to
// accepting, no extra confirm tap. accept_invite is mandal-scoped and
// idempotent, so there's nothing unsafe about that shortcut. ponytail: no
// "continue as X?" confirmation screen for the already-signed-in case;
// add one only if that shortcut ever proves surprising in practice.
export function JoinInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { loading, session, refreshAppUser } = useAuth()
  const [status, setStatus] = useState<Status>('checking')
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const acceptingRef = useRef(false)

  useEffect(() => {
    let active = true
    if (!token) {
      setStatus('invalid')
      return
    }
    previewInvite(token)
      .then((result) => {
        if (!active) return
        if (!result) {
          setStatus('invalid')
          return
        }
        setPreview(result)
        setStatus('ready')
      })
      // previewInvite throws on a genuine RPC failure (not just an
      // unresolved token) — this page has no retry affordance, so folding
      // it into the same invalid-link state is the honest simplest option;
      // the copy ("ask for a fresh link") is still directionally correct
      // even for a transient failure.
      .catch(() => {
        if (active) setStatus('invalid')
      })
    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    if (loading || status !== 'ready' || !session || session.user.is_anonymous || !token) return
    if (acceptingRef.current) return
    acceptingRef.current = true
    setStatus('accepting')
    acceptInvite(token)
      .then(async () => {
        await refreshAppUser()
        navigate(preview && isAdminRole(preview.role) ? '/admin' : '/collect', { replace: true })
      })
      .catch((err: unknown) => {
        acceptingRef.current = false
        setError(err instanceof Error ? err.message : String(err))
        setStatus('accept-error')
      })
  }, [loading, session, status, token, preview, refreshAppUser, navigate])

  if (status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-stone-400">{t.loading}</div>
  }

  if (status === 'invalid') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p role="alert" className="text-stone-900">
          {t.joinInvalid}
        </p>
        <p className="text-sm leading-relaxed text-stone-500">{t.joinInvalidHelp}</p>
      </main>
    )
  }

  if (status === 'accepting') {
    return <div className="flex min-h-screen items-center justify-center text-stone-400">{t.inviteSettingUp}</div>
  }

  // 'ready' or 'accept-error' — preview is always set by this point.
  const p = preview!
  const roleLabel = p.role === 'admin' ? t.joinRoleAdmin : t.joinRoleVolunteer

  return (
    <AuthShell title={p.mandalName} subtitle={`${t.joinInvitedAsPrefix} ${roleLabel}, ${p.invitee}`}>
      <AuthMethods redirectTo={`${window.location.origin}/join/${token}`} />
      {status === 'accept-error' && error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </AuthShell>
  )
}
```

- [ ] **Step 2: Add the new strings, remove the ones only the old component used**

In `src/lib/strings.ts`'s `auth` block, remove these (unique to the old anonymous-session flow): `inviteInvalid`, `inviteInvalidHelp`, `inviteInvitedAs`, `inviteSessionFailed`, `inviteSessionFailedHelp`, `inviteSwitchTitle`, `inviteSwitchBody`, `inviteSwitchContinue`, `inviteSwitchCancel`. Keep `inviteSettingUp` (still used, reworded slightly is fine but not required) and everything else. Add:
```ts
    joinInvalid: 'This invite link is invalid or has expired.',
    joinInvalidHelp: 'Ask whoever invited you to send a fresh link from Manage Members.',
    joinInvitedAsPrefix: 'invites you as',
    joinRoleAdmin: 'an admin',
    joinRoleVolunteer: 'a volunteer',
```

- [ ] **Step 3: Wire the route**

In `src/app/router.tsx`, replace the import:
```tsx
import { InviteRedeem } from '../features/auth/InviteRedeem'
```
with:
```tsx
import { JoinInvite } from '../features/auth/JoinInvite'
import { useParams, Navigate as RouterNavigate } from 'react-router-dom'
```
(the second import is only needed if `Navigate`/`useParams` aren't already imported at the top — check first; this file already imports `Navigate` from `react-router-dom` at line 1, so only add `useParams` to that existing import line rather than a second import statement.)

Add this small helper above `AppRoutes` (old bookmarked/shared `/invite/:token` links still need to land somewhere real):
```tsx
// Old links (shared before v5) still point at /invite/:token. Forward to
// /join/:token — the token itself won't resolve (invite_token was never
// migrated into the new invites table, per the v5 plan's Decision 2), so
// this lands on JoinInvite's own "invalid or expired" state rather than a
// generic 404, which is the more honest message for a truly dead link.
function LegacyInviteRedirect() {
  const { token } = useParams<{ token: string }>()
  return <RouterNavigate to={`/join/${token}`} replace />
}
```

Replace:
```tsx
      <Route path="/invite/:token" element={<InviteRedeem />} />
```
with:
```tsx
      <Route path="/join/:token" element={<JoinInvite />} />
      <Route path="/invite/:token" element={<LegacyInviteRedirect />} />
```

- [ ] **Step 4: Delete the old component and its test**

```bash
git rm src/features/auth/InviteRedeem.tsx tests/InviteRedeem.test.tsx
```

- [ ] **Step 5: Write `tests/JoinInvite.test.tsx`**

Follow `tests/RequireRole.test.tsx`'s mocking shape (mock `../src/lib/db/client`'s `supabase`, not `members.ts`, so the RPC-call assertions stay meaningful) and `tests/Signup.test.tsx`'s `useNavigate` mock:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../src/features/auth/AuthProvider'
import { JoinInvite } from '../src/features/auth/JoinInvite'

const { getSession, onAuthStateChange, rpc, maybeSingle, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    rpc: vi.fn(),
    maybeSingle,
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }),
    })),
  }
})

vi.mock('../src/lib/db/client', () => ({
  supabase: { auth: { getSession, onAuthStateChange }, rpc, from },
}))

const realSession = { user: { id: 'real-uid-1', is_anonymous: false } } as unknown as Session

function renderJoinInvite(token: string) {
  render(
    <MemoryRouter initialEntries={[`/join/${token}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/join/:token" element={<JoinInvite />} />
          <Route path="/admin" element={<div>Admin Home</div>} />
          <Route path="/collect" element={<div>Volunteer Home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function mockRpc(opts: { preview?: unknown[]; accept?: { data: unknown; error: unknown } } = {}) {
  const preview = opts.preview ?? [{ mandal_name: 'Vinayak Mitra Mandal', role: 'volunteer', invitee_name: 'Sita Volunteer' }]
  const accept = opts.accept ?? { data: null, error: null }
  rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'invite_preview' ? { data: preview, error: null } : accept))
}

beforeEach(() => {
  vi.clearAllMocks()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  getSession.mockResolvedValue({ data: { session: null }, error: null })
})

describe('JoinInvite', () => {
  it('shows the invalid state for an unknown token', async () => {
    mockRpc({ preview: [] })
    renderJoinInvite('bad-token')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i))
  })

  it('names the mandal + role and offers Google/email when there is no session', async () => {
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Vinayak Mitra Mandal')).toBeInTheDocument())
    expect(screen.getByText(/invites you as/i)).toBeInTheDocument()
    expect(screen.getByText('Continue with Google')).toBeInTheDocument()
  })

  it('auto-accepts and routes to /collect for a volunteer once a real session is present', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Volunteer Home')).toBeInTheDocument())
    expect(rpc).toHaveBeenCalledWith('accept_invite', { token: 'good-token' })
  })

  it('routes to /admin for an admin-role invite', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc({ preview: [{ mandal_name: 'Vinayak Mitra Mandal', role: 'admin', invitee_name: 'New Admin' }] })
    renderJoinInvite('admin-token')
    await waitFor(() => expect(screen.getByText('Admin Home')).toBeInTheDocument())
  })

  it('does not auto-accept on an anonymous session — shows the auth methods instead', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'x', is_anonymous: true } } }, error: null })
    mockRpc()
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument())
    expect(rpc).not.toHaveBeenCalledWith('accept_invite', expect.anything())
  })

  it('shows an accept error without navigating away', async () => {
    getSession.mockResolvedValue({ data: { session: realSession }, error: null })
    mockRpc({ accept: { data: null, error: { message: 'this invite is locked to a different email address' } } })
    renderJoinInvite('good-token')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/locked to a different email/i))
    expect(screen.queryByText('Volunteer Home')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run**

```bash
npm run typecheck
npx vitest run tests/JoinInvite.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add -A src/features/auth src/app/router.tsx src/lib/strings.ts tests/JoinInvite.test.tsx
git commit -m "feat(auth): replace InviteRedeem with JoinInvite — real identity for every invite"
```

---

## Task 13: Welcome flow — no dead end for "I was invited"

**Files:**
- Modify: `src/features/auth/Signup.tsx` (the `mode === 'invited'` block, ~lines 122–139)
- Modify: `src/lib/strings.ts` (`signupChoice` additions)

**Interfaces:** none new beyond a small local `extractJoinToken` helper.

- [ ] **Step 1: Add the paste-link box to the `invited` mode**

Replace:
```tsx
  if (mode === 'invited') {
    return (
      <AuthShell title={c.invitedTitle} subtitle={c.invitedBody}>
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
            {c.invitedHint}
          </p>
          <button
            type="button"
            onClick={() => setMode('choose')}
            className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700"
          >
            {c.back}
          </button>
        </div>
      </AuthShell>
    )
  }
```
with:
```tsx
  if (mode === 'invited') {
    return (
      <AuthShell title={c.invitedTitle} subtitle={c.invitedBody}>
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
            {c.invitedHint}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const token = extractJoinToken(pasteLink)
              if (token) navigate(`/join/${token}`)
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="paste-link" className="text-sm font-semibold text-stone-700">
              {c.pasteLinkLabel}
            </label>
            <input
              id="paste-link"
              value={pasteLink}
              onChange={(event) => setPasteLink(event.target.value)}
              placeholder={c.pasteLinkPlaceholder}
              className={inputCls}
            />
            <button type="submit" disabled={!pasteLink.trim()} className="mt-1 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-colors hover:bg-stone-900 disabled:opacity-50">
              {c.pasteLinkGo}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setMode('choose')}
            className="text-center text-sm font-semibold text-stone-500 hover:text-stone-700"
          >
            {c.back}
          </button>
        </div>
      </AuthShell>
    )
  }
```

- [ ] **Step 2: Add the state + helper**

Near the top of `Signup.tsx`, alongside the other `useState` calls (after `const [mode, setMode] = useState<'choose' | 'create' | 'invited'>('choose')`):
```tsx
  const [pasteLink, setPasteLink] = useState('')
```

Above the `Signup` component, alongside `previewSlug`:
```tsx
// Accepts either a bare token or a full /join/... (or legacy /invite/...)
// URL pasted from WhatsApp — extracts just the token either way.
function extractJoinToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(/\/(join|invite)\/([^/?#\s]+)/)
  return match ? match[2] : trimmed
}
```

- [ ] **Step 3: Add the new strings**

In `src/lib/strings.ts`'s `signupChoice` block, add:
```ts
    pasteLinkLabel: 'Or paste your invite link',
    pasteLinkPlaceholder: 'Paste the link here…',
    pasteLinkGo: 'Continue',
```

- [ ] **Step 4: Update `tests/Signup.test.tsx`'s expectations if needed, then run**

```bash
npm run typecheck
npx vitest run tests/Signup.test.tsx
```
The existing tests all go through `mode === 'create'` and shouldn't be affected by this `invited`-mode-only change; confirm they still pass unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/Signup.tsx src/lib/strings.ts
git commit -m "feat(onboarding): 'I was invited' can paste a link instead of dead-ending"
```

---

## Task 14: Anonymous-session upgrade banner

**Files:**
- Create: `src/components/AnonUpgradeBanner.tsx`
- Modify: `src/components/AppShell.tsx` (render it; also fix its own `role === 'admin'` check)
- Modify: `src/lib/strings.ts` (`auth` additions)

**Interfaces:**
- Produces: `export function AnonUpgradeBanner(): JSX.Element | null`.
- Consumed by: `AppShell.tsx` (used by every `/collect/*` screen — the only place an anonymous session is ever encountered post-v5).

- [ ] **Step 1: Write the banner**

```tsx
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/db/client'
import { useAuth } from '../features/auth/useAuth'
import { strings } from '../lib/strings'

const t = strings.auth

// Transition aid for volunteers who joined before v5 (an anonymous Supabase
// session bound by the old invite_token flow — see the v5 plan's Decision
// 1). Upgrading in place (linkIdentity/updateUser) keeps the SAME
// auth_user_id, so the existing `users` row and every donation it collected
// stay attached: nothing to migrate, nothing server-side to call.
// ponytail: no "don't show again" persistence — a returning volunteer sees
// this again next visit until they actually upgrade, which is the point.
export function AnonUpgradeBanner() {
  const { session } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  if (!session?.user.is_anonymous || dismissed) return null

  async function upgradeWithGoogle() {
    setBusy(true)
    await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: window.location.href } })
  }

  async function upgradeWithEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email })
    setBusy(false)
    if (!error) setSent(true)
  }

  return (
    <div className="mx-4 mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-amber-900">{t.upgradeTitle}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t.upgradeDismiss}
          className="text-amber-600 hover:text-amber-800"
        >
          ✕
        </button>
      </div>
      {sent ? (
        <p className="text-amber-800">{t.upgradeEmailSent}</p>
      ) : (
        <>
          <p className="text-amber-800">{t.upgradeBody}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={upgradeWithGoogle}
              disabled={busy}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {t.upgradeWithGoogle}
            </button>
            <form onSubmit={upgradeWithEmail} className="flex items-center gap-1.5">
              <input
                type="email"
                required
                placeholder={t.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-40 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs text-stone-900 outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {t.upgradeWithEmail}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `AppShell.tsx`, fix the role check**

Replace:
```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db/client'
import { useAuth } from '../features/auth/useAuth'
import { strings } from '../lib/strings'
import { backLink as backLinkCls } from './ui'
```
with:
```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db/client'
import { useAuth } from '../features/auth/useAuth'
import { strings } from '../lib/strings'
import { backLink as backLinkCls } from './ui'
import { isAdminRole } from '../lib/roles'
import { AnonUpgradeBanner } from './AnonUpgradeBanner'
```

Replace:
```tsx
  const { appUser } = useAuth()
  const home = appUser?.role === 'admin' ? '/admin' : '/collect'
```
with:
```tsx
  const { appUser } = useAuth()
  const home = isAdminRole(appUser?.role ?? '') ? '/admin' : '/collect'
```

Insert `<AnonUpgradeBanner />` immediately after the closing `</header>` tag and before the `<div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">` content block.

- [ ] **Step 3: Add the strings**

In `src/lib/strings.ts`'s `auth` block, add:
```ts
    upgradeTitle: 'Secure your account',
    upgradeBody: 'Add a Google account or email so you can sign in from any phone — not just this one.',
    upgradeWithGoogle: 'Add Google',
    upgradeWithEmail: 'Save',
    upgradeEmailSent: "Check that email and open the confirmation link to finish.",
    upgradeDismiss: 'Dismiss',
```

- [ ] **Step 4: Typecheck + run existing AppShell-adjacent tests**

```bash
npm run typecheck
npx vitest run
```
(Full suite — this task touches a widely-shared component; confirm nothing else regressed.)

- [ ] **Step 5: Commit**

```bash
git add src/components/AnonUpgradeBanner.tsx src/components/AppShell.tsx src/lib/strings.ts
git commit -m "feat(auth): dismissible upgrade banner for pre-v5 anonymous volunteer sessions"
```

---

## Task 15: Manage Members screen (`/admin/members`)

**Files:**
- Create: `src/features/settings/members.tsx`
- Modify: `src/lib/strings.ts` (new `members` block; keep `volunteers`/`admins` blocks only if Task 16 hasn't deleted their consumers yet — Task 16 removes them)

**Interfaces:**
- Produces: `export function ManageMembersContent(): JSX.Element`.
- Consumes: everything from `src/lib/db/members.ts` (Task 11), `Sheet`, `ConfirmDialog`, `PhoneInput`, `card`/`field`/`btnPrimary`/`btnGhost`/`errorText` from `ui.ts`, `isOwnerRole`/`isAdminRole` from `roles.ts`.

- [ ] **Step 1: Add the `members` strings block**

In `src/lib/strings.ts`, add a new top-level block (alongside `volunteers`/`admins`):
```ts
  members: {
    title: 'Members',
    filterAll: 'All',
    filterOwner: 'Owner',
    filterAdmins: 'Admins',
    filterVolunteers: 'Volunteers',
    inviteButton: 'Invite member',
    inviteSheetTitle: 'Invite a member',
    roleLabel: 'Role',
    roleAdmin: 'Admin',
    roleVolunteer: 'Volunteer',
    nameLabel: 'Name',
    emailLabel: 'Email (optional)',
    emailHelp: 'Locks the invite link to this Google/email account.',
    phoneLabel: 'Phone (optional)',
    sendButton: 'Create invite link',
    sending: 'Creating…',
    linkReadyTitle: 'Invite link ready',
    copyLink: 'Copy link',
    copied: 'Copied!',
    shareWhatsApp: 'Share on WhatsApp',
    done: 'Done',
    statusInvited: 'Invited',
    statusActive: 'Active',
    statusDeactivated: 'Deactivated',
    expiresIn: (days: number) => (days <= 0 ? 'Expires today' : `Expires in ${days}d`),
    roleOwner: 'Owner',
    empty: 'No members yet.',
    resendButton: 'Resend',
    revokeButton: 'Revoke',
    revokeTitle: 'Revoke this invite?',
    revokeBody: 'The link stops working immediately. You can invite them again any time.',
    revokeConfirm: 'Revoke invite',
    makeAdmin: 'Make admin',
    makeVolunteer: 'Make volunteer',
    makeOwner: 'Make owner',
    makeOwnerTitle: 'Transfer ownership?',
    makeOwnerBody: 'They become the owner and gain full control, including Manage Members and the danger zone. You become an admin. This cannot be undone by you alone.',
    makeOwnerConfirm: 'Transfer ownership',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
    deactivateTitle: 'Deactivate this member?',
    deactivateBody: 'They lose access immediately. Donations, expenses, and handovers they already recorded stay in your books.',
    deactivateConfirm: 'Deactivate',
  },
```
Note: `expiresIn` is a function, not a string — this is a small, deliberate deviation from the rest of `strings.ts` (which is otherwise all plain string/object literals). If that pattern feels wrong for this codebase once you're looking at the full file, inline the day-math in the component instead and drop this entry — either is fine, this is a cosmetic call, not a behavior one.

- [ ] **Step 2: Write `members.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchMembers,
  fetchPendingInvites,
  createInvite,
  revokeInvite,
  resendInvite,
  setMemberRole,
  transferOwnership,
  deactivateMember,
  reactivateMember,
  type Member,
  type PendingInvite,
} from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { card, field, label as labelCls, btnPrimary, btnGhost, errorText } from '../../components/ui'
import { Sheet } from '../../components/Sheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PhoneInput } from '../../components/PhoneInput'
import { isOwnerRole, isAdminRole } from '../../lib/roles'

const t = strings.members

type Filter = 'all' | 'owner' | 'admins' | 'volunteers'

function matchesFilter(role: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'owner') return role === 'owner'
  if (filter === 'admins') return role === 'admin'
  return role === 'volunteer'
}

function inviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

// Replaces admins.tsx + volunteers.tsx: one list, one invite flow, per
// v5's "one coherent system" — every action below is additionally gated
// server-side by the RPC itself (create_invite/set_member_role/etc.), this
// UI-level gating is only about not offering a button that would fail.
export function ManageMembersContent() {
  const { appUser } = useAuth()
  const myRole = appUser?.role ?? ''
  const iAmOwner = isOwnerRole(myRole)

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [inviteRole, setInviteRole] = useState<'admin' | 'volunteer'>('volunteer')
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteLinkReady, setInviteLinkReady] = useState<string | null>(null)

  const [revoking, setRevoking] = useState<PendingInvite | null>(null)
  const [deactivating, setDeactivating] = useState<Member | null>(null)
  const [transferring, setTransferring] = useState<Member | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  async function reload() {
    const [m, i] = await Promise.all([fetchMembers(), fetchPendingInvites()])
    setMembers(m)
    setInvites(i)
  }

  useEffect(() => {
    let active = true
    reload()
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function resetInviteForm() {
    setInviteName('')
    setInviteEmail('')
    setInvitePhone('')
    setInviteRole('volunteer')
    setInviteLinkReady(null)
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInviteSubmitting(true)
    setError(null)
    try {
      const token = await createInvite(inviteRole, inviteName, inviteEmail || undefined, invitePhone || undefined)
      setInviteLinkReady(inviteLink(token))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleRevoke() {
    if (!revoking) return
    setRowBusy(revoking.id)
    try {
      await revokeInvite(revoking.id)
      setRevoking(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleResend(invite: PendingInvite) {
    setRowBusy(invite.id)
    setError(null)
    try {
      await resendInvite(invite.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleRoleChange(member: Member, role: 'admin' | 'volunteer') {
    setRowBusy(member.id)
    setError(null)
    try {
      await setMemberRole(member.id, role)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleTransfer() {
    if (!transferring) return
    setRowBusy(transferring.id)
    try {
      await transferOwnership(transferring.id)
      setTransferring(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return
    setRowBusy(deactivating.id)
    try {
      await deactivateMember(deactivating.id)
      setDeactivating(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleReactivate(member: Member) {
    setRowBusy(member.id)
    setError(null)
    try {
      await reactivateMember(member.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  const visibleMembers = members.filter((m) => matchesFilter(m.role, filter))
  const visibleInvites = filter === 'all' || filter === 'admins' || filter === 'volunteers'
    ? invites.filter((i) => filter === 'all' || matchesFilter(i.role, filter))
    : []

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['all', 'owner', 'admins', 'volunteers'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                filter === f ? 'bg-orange-600 text-white' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {f === 'all' ? t.filterAll : f === 'owner' ? t.filterOwner : f === 'admins' ? t.filterAdmins : t.filterVolunteers}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSheetOpen(true)} className={btnPrimary}>
          {t.inviteButton}
        </button>
      </div>

      {error && (
        <p role="alert" className={`${errorText} mt-3`}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-stone-400">{strings.auth.loading}</p>
      ) : visibleMembers.length === 0 && visibleInvites.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {t.empty}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {visibleInvites.map((invite) => (
            <li key={invite.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-stone-900">{invite.name}</span>
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                    {invite.role === 'admin' ? t.roleAdmin : t.roleVolunteer}
                  </span>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {t.statusInvited} · {t.expiresIn(daysUntil(invite.expiresAt))}
                </span>
              </div>
              {(invite.email || invite.phone) && (
                <p className="mt-0.5 text-sm text-stone-500">{[invite.email, invite.phone].filter(Boolean).join(' · ')}</p>
              )}
              <div className="mt-3 flex gap-2">
                {(invite.role === 'volunteer' || iAmOwner) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleResend(invite)}
                      disabled={rowBusy === invite.id}
                      className={`${btnGhost} px-3 py-1.5 text-xs`}
                    >
                      {t.resendButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevoking(invite)}
                      disabled={rowBusy === invite.id}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      {t.revokeButton}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}

          {visibleMembers.map((member) => (
            <li key={member.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-stone-900">{member.name}</span>
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                    {member.role === 'owner' ? t.roleOwner : member.role === 'admin' ? t.roleAdmin : t.roleVolunteer}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    member.active ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-500'
                  }`}
                >
                  {member.active ? t.statusActive : t.statusDeactivated}
                </span>
              </div>
              {(member.email || member.phone) && (
                <p className="mt-0.5 text-sm text-stone-500">{[member.email, member.phone].filter(Boolean).join(' · ')}</p>
              )}

              {iAmOwner && member.role !== 'owner' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {member.role === 'volunteer' ? (
                    <button type="button" onClick={() => handleRoleChange(member, 'admin')} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.makeAdmin}
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => handleRoleChange(member, 'volunteer')} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                        {t.makeVolunteer}
                      </button>
                      {member.active && (
                        <button type="button" onClick={() => setTransferring(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                          {t.makeOwner}
                        </button>
                      )}
                    </>
                  )}
                  {member.active ? (
                    <button type="button" onClick={() => setDeactivating(member)} disabled={rowBusy === member.id} className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600">
                      {t.deactivate}
                    </button>
                  ) : (
                    <button type="button" onClick={() => handleReactivate(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.reactivate}
                    </button>
                  )}
                </div>
              )}

              {isAdminRole(myRole) && !iAmOwner && member.role === 'volunteer' && (
                <div className="mt-3">
                  {member.active ? (
                    <button type="button" onClick={() => setDeactivating(member)} disabled={rowBusy === member.id} className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600">
                      {t.deactivate}
                    </button>
                  ) : (
                    <button type="button" onClick={() => handleReactivate(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.reactivate}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} labelledBy="invite-sheet-title">
        {inviteLinkReady ? (
          <div className="flex flex-col gap-3">
            <h2 id="invite-sheet-title" className="font-display text-lg font-bold text-stone-900">
              {t.linkReadyTitle}
            </h2>
            <input readOnly value={inviteLinkReady} className={`${field} text-sm`} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(inviteLinkReady)}
                className={`flex-1 ${btnGhost}`}
              >
                {t.copyLink}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(inviteLinkReady)}`}
                target="_blank"
                rel="noreferrer"
                className={`flex-1 ${btnPrimary} text-center`}
              >
                {t.shareWhatsApp}
              </a>
            </div>
            <button
              type="button"
              onClick={() => {
                setSheetOpen(false)
                resetInviteForm()
              }}
              className={btnGhost}
            >
              {t.done}
            </button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="flex flex-col gap-3">
            <h2 id="invite-sheet-title" className="font-display text-lg font-bold text-stone-900">
              {t.inviteSheetTitle}
            </h2>
            <div>
              <span className={labelCls}>{t.roleLabel}</span>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setInviteRole('volunteer')}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                    inviteRole === 'volunteer' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
                  }`}
                >
                  {t.roleVolunteer}
                </button>
                {iAmOwner && (
                  <button
                    type="button"
                    onClick={() => setInviteRole('admin')}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                      inviteRole === 'admin' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
                    }`}
                  >
                    {t.roleAdmin}
                  </button>
                )}
              </div>
            </div>
            <label htmlFor="invite-name" className={labelCls}>
              {t.nameLabel}
            </label>
            <input id="invite-name" required value={inviteName} onChange={(e) => setInviteName(e.target.value)} className={field} />
            <label htmlFor="invite-email" className={labelCls}>
              {t.emailLabel}
            </label>
            <input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className={field} />
            <p className="text-xs text-stone-500">{t.emailHelp}</p>
            <PhoneInput id="invite-phone" label={t.phoneLabel} value={invitePhone} onChange={setInvitePhone} />
            <button type="submit" disabled={inviteSubmitting} className={btnPrimary}>
              {inviteSubmitting ? t.sending : t.sendButton}
            </button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog
        open={revoking !== null}
        title={t.revokeTitle}
        body={t.revokeBody}
        confirmLabel={t.revokeConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleRevoke}
        onCancel={() => setRevoking(null)}
        busy={rowBusy === revoking?.id}
      />
      <ConfirmDialog
        open={deactivating !== null}
        title={t.deactivateTitle}
        body={t.deactivateBody}
        confirmLabel={t.deactivateConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivating(null)}
        busy={rowBusy === deactivating?.id}
      />
      <ConfirmDialog
        open={transferring !== null}
        title={t.makeOwnerTitle}
        body={t.makeOwnerBody}
        confirmLabel={t.makeOwnerConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleTransfer}
        onCancel={() => setTransferring(null)}
        busy={rowBusy === transferring?.id}
      />
    </>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/members.tsx src/lib/strings.ts
git commit -m "feat: add Manage Members screen (replaces admins.tsx + volunteers.tsx)"
```

---

## Task 16: Wire `/admin/members`, delete the old screens

**Files:**
- Modify: `src/app/router.tsx` (route swap)
- Modify: `src/features/admin/AdminLayout.tsx:27-28` (NAV array)
- Modify: `src/lib/strings.ts` (`admin.volunteersLink`/`admin.adminsLink` → `admin.membersLink`)
- Delete: `src/features/settings/admins.tsx`, `src/features/settings/volunteers.tsx`, `tests/AdminLayout.test.tsx`'s stale assertion (update, not delete — see Step 4)

- [ ] **Step 1: Router**

In `src/app/router.tsx`, replace the imports:
```tsx
import { VolunteersContent } from '../features/settings/volunteers'
import { AdminsContent } from '../features/settings/admins'
```
with:
```tsx
import { ManageMembersContent } from '../features/settings/members'
```
and replace:
```tsx
        <Route path="/admin/volunteers" element={<VolunteersContent />} />
        <Route path="/admin/admins" element={<AdminsContent />} />
```
with:
```tsx
        <Route path="/admin/members" element={<ManageMembersContent />} />
```

- [ ] **Step 2: `AdminLayout.tsx` nav**

Replace:
```tsx
  { to: '/admin/volunteers', icon: '🧑‍🤝‍🧑', label: a.volunteersLink },
  { to: '/admin/admins', icon: '🛡️', label: a.adminsLink },
```
with:
```tsx
  { to: '/admin/members', icon: '🧑‍🤝‍🧑', label: a.membersLink },
```

- [ ] **Step 3: `strings.ts`**

In `src/lib/strings.ts`'s `admin` block, replace:
```ts
    volunteersLink: 'Manage volunteers',
```
```ts
    adminsLink: 'Manage admins',
```
with a single:
```ts
    membersLink: 'Manage members',
```
(remove both old keys, add the one new one, in the same positions).

- [ ] **Step 4: Update `tests/AdminLayout.test.tsx`**

Replace the test:
```tsx
  it('links to the admin management screen', () => {
    renderAt('/admin')
    const links = screen.getAllByRole('link', { name: 'Manage admins' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/admin/admins')
  })
```
with:
```tsx
  it('links to the manage-members screen', () => {
    renderAt('/admin')
    const links = screen.getAllByRole('link', { name: 'Manage members' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/admin/members')
  })
```

- [ ] **Step 5: Delete the old screens and their tests**

```bash
git rm src/features/settings/admins.tsx src/features/settings/volunteers.tsx
```
(there are no separate `admins.test.tsx`/`volunteers.test.tsx` files — confirm with `git ls-files tests/ | grep -i -E "admins|volunteers"` before assuming; if any exist, remove them too since `ManageMembersContent` has no equivalent per-file split.)

- [ ] **Step 6: Typecheck + run**

```bash
npm run typecheck
npx vitest run tests/AdminLayout.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add -A src/app/router.tsx src/features/admin/AdminLayout.tsx src/lib/strings.ts tests/AdminLayout.test.tsx
git commit -m "feat: wire /admin/members, delete the old split admins/volunteers screens"
```

---

## Task 17: Cross-cutting `role === 'admin'` fixups (CollectionForm, Collections)

**Files:**
- Modify: `src/features/collection/CollectionForm.tsx:66,101,102`
- Modify: `src/features/collection/Collections.tsx:162,470` + the Danger Zone purge gating (~lines 367-410)

**Interfaces:** consumes `isAdminRole`/`isOwnerRole` from `src/lib/roles.ts` (Task 7).

- [ ] **Step 1: `CollectionForm.tsx`**

Add the import (alongside its other imports at the top of the file), then:
- Replace `const isAdmin = role === 'admin'` (line 66) with `const isAdmin = isAdminRole(role)`.
- Replace `const isAdmin = appUser?.role === 'admin'` (line 101) with `const isAdmin = isAdminRole(appUser?.role ?? '')`.
- Line 102's `const isVolunteer = appUser?.role === 'volunteer'` stays as-is (an owner is not a volunteer; no change needed there).

- [ ] **Step 2: `Collections.tsx` — the two `isAdmin` derivations**

Add the `isAdminRole`/`isOwnerRole` import, then replace both occurrences of `const isAdmin = appUser?.role === 'admin'` (lines 162 and 470) with `const isAdmin = isAdminRole(appUser?.role ?? '')`.

- [ ] **Step 3: `Collections.tsx` — Danger Zone purge moves to owner-only**

Read the Danger Zone section fully first (`grep -n "dangerZone\|purgeRemovedOpen\|purgeAllOpen\|purgeDonations" src/features/collection/Collections.tsx` to find every line touching purge state/UI), since the exact JSX structure around the two purge buttons (`purgeRemovedOpen`/`purgeAllOpen`) needs to gate on ownership without breaking the "clear all" button, which stays admin+owner. Add a local `const isOwner = isOwnerRole(appUser?.role ?? '')` next to the `isAdmin` derivation from Step 2, then wrap only the two purge-button blocks (not the "clear all" block) in `{isOwner && (...)}`, matching the existing `{hasActive && (...)}` conditional-block style already used for "clear all" in that same section. Update `strings.collections` copy only if the current purge hint text implies "admin" specifically (grep `t.purgeRemovedHint`/`t.purgeAllHint` in `strings.ts` first) — if it's role-neutral, leave the copy untouched.

- [ ] **Step 4: Typecheck + run**

```bash
npm run typecheck
npx vitest run tests/CollectionForm.test.tsx tests/Collections.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/collection/CollectionForm.tsx src/features/collection/Collections.tsx
git commit -m "fix: use isAdminRole so the owner role isn't excluded from admin-gated UI"
```

---

## Task 18: e2e spec updates

**Files:**
- Modify: `e2e/admin-auth.spec.ts` (drop the `link_admin_account` route mock, now-dead)
- Modify: `e2e/volunteer-invite.spec.ts` → rename to `e2e/join-invite.spec.ts`, rewrite for the new flow
- Check: `e2e/mandal-signup.spec.ts` for any `role === 'admin'`/owner-sensitive assertions

- [ ] **Step 1: `admin-auth.spec.ts`**

Remove the now-pointless mock (the RPC doesn't exist anymore, so this `page.route` handler is simply never hit — Playwright doesn't fail on an unmatched route mock, but it's dead code):
```ts
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/link_admin_account*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  )
```
Remove both occurrences (one per test in this file). Also add `role: 'admin'` stays valid since admins still exist as a role — no other change needed in this file's mocked `users` row shape beyond dropping `invite_token: null` from the fixture object (harmless to leave, since it's just extra JSON the app no longer reads, but drop it for accuracy: it's not a real column anymore).

- [ ] **Step 2: Rename and rewrite the invite e2e spec**

```bash
git mv e2e/volunteer-invite.spec.ts e2e/join-invite.spec.ts
```

Rewrite its content — the old file tested `/invite/:token` + `signInAnonymously` failure; the equivalent v5 behavior is `/join/:token` + `invite_preview` returning nothing / erroring:

```ts
import { test, expect } from '@playwright/test'

const SUPABASE_URL = 'http://127.0.0.1:54321' // matches .env.local's VITE_SUPABASE_URL

test('an unknown or expired invite link fails cleanly, not a silent redirect to /login', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/invite_preview*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await page.goto('/join/some-bogus-token')

  await expect(page.getByRole('alert')).toHaveText(/invalid or has expired/i)
  await expect(page).not.toHaveURL(/\/login$/)
})

test('a live invite names the mandal and role before any sign-in', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/invite_preview*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ mandal_name: 'Vinayak Mitra Mandal', role: 'volunteer', invitee_name: 'Sita Volunteer' }]),
    }),
  )

  await page.goto('/join/live-token')

  await expect(page.getByText('Vinayak Mitra Mandal')).toBeVisible()
  await expect(page.getByText(/invites you as/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
})
```

(A real Google/email round trip through `accept_invite` still can't be tested without a live Supabase project + email delivery / a real OAuth consent screen — same limitation the old file's own comment already noted for magic-link auth generally. Leave that as manual verification once deployed, matching `admin-auth.spec.ts`'s existing precedent.)

- [ ] **Step 3: Check `mandal-signup.spec.ts` for anything role-sensitive**

```bash
grep -n "role\|admin\|owner" e2e/mandal-signup.spec.ts
```
If it asserts on `role: 'admin'` for the just-created mandal's founder, update to `role: 'owner'` (per `create_mandal`'s Task 2 change). If it doesn't reference role at all, no change needed.

- [ ] **Step 4: Run the e2e suite**

```bash
npm run test:e2e
```
This needs a dev server (Playwright's config likely starts one — check `playwright.config.ts`'s `webServer` block if this fails to boot). If e2e can't run in this environment (no browser/display), note that explicitly rather than claiming it passed — this is exactly the "if you can't test the UI, say so" rule.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): update auth specs for JoinInvite + owner role"
```

---

## Task 19: Config, prod anonymous sign-in, final verification

**Files:**
- Modify: `supabase/config.toml:177` (`enable_anonymous_sign_ins`)

- [ ] **Step 1: Turn off anonymous sign-ins locally**

In `supabase/config.toml`, change:
```toml
enable_anonymous_sign_ins = true
```
to:
```toml
enable_anonymous_sign_ins = false
```
(Per Decision 7 — safe for already-redeemed volunteers; no v5 UI path calls `signInAnonymously()` anymore after Task 12 removes `InviteRedeem.tsx`.) This file only affects `supabase start`/local GoTrue, not `verify-local.sh` (which stubs `auth.*` directly in SQL and never touches this setting) — so no harness impact.

- [ ] **Step 2: Flag the prod-side follow-up (manual, not automatable from the CLI)**

The Supabase project's **Authentication → Sign In / Providers → Anonymous Sign-Ins** toggle is a dashboard setting, not something `supabase db push` touches. Tell the user directly: turn it off in the `rwcodlxouxilukiknydo` project dashboard once this branch is deployed and verified — don't do this automatically as part of the migration, since it's an irreversible-feeling setting change on a live project or a step worth them confirming with eyes on the dashboard first (see this plan's "risky action" guidance: dashboard-level config affecting a live user base warrants a confirm, not a silent flip).

- [ ] **Step 3: Full verification**

```bash
npm run verify
```
( = `typecheck && test && test:rls && build` — every prior task already ran its own slice of this; this is the full-suite gate before calling the branch done.)

- [ ] **Step 4: Manual smoke test via the dev server**

```bash
npm run dev
```
Walk the golden paths a type-check can't verify:
- `/signup` → "Create a new mandal" → new owner lands on `/admin`.
- `/admin/members` → Invite member (volunteer) → copy the link → open it in a private/incognito window → "Continue with Google" (or email) → lands on `/collect`.
- Same, but invite an admin as the owner; confirm a plain admin's Manage Members can't offer an "Invite → Admin" option (UI-gated) and that attempting it via `create_invite('admin', ...)` from the browser console as a plain admin fails server-side (belt-and-suspenders check on Task 2's RLS).
- Owner → transfer ownership to that admin → confirm the former owner is now listed as Admin, danger-zone purge buttons disappear for them.
- `/join/<stale-or-revoked-token>` shows the invalid-link screen, not a crash.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: disable local anonymous sign-ins (no v5 UI path uses them)"
```

---

## Self-review notes (for whoever executes this)

- **Spec coverage:** identity (Task 10/12/14), membership schema+RPCs (Task 1/2), permission matrix (`is_admin()`/`is_owner()` in Task 1, enforced per-RPC in Task 2, mirrored in UI in Task 15/17), Manage Members (Task 15/16), onboarding/Welcome (Task 13), migration-plan phasing (Decisions 1–2 explain the deliberate compression), definition-of-done flows (Task 19 Step 4 walks all of them manually). The one spec item NOT built is "delete mandal" — Decision 6 explains why, explicitly, rather than silently dropping it.
- **Known simplification to revisit if it matters in practice:** JoinInvite's "auto-accept, no confirm tap" behavior for an already-signed-in real session (Task 12) — flagged inline as a `ponytail:`-style judgment call, not a spec requirement.
- **Ordering matters:** Tasks 1→6 (DB) must land and be pushed to prod, with types regenerated, before Task 7 onward — the frontend RPC calls won't typecheck against stale generated types otherwise.
