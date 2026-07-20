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
-- donations/expenses/handovers through the app. But 20260717150000_demo_mandal.sql
-- proves auth_user_id IS NULL alone isn't sufficient to prove that: it seeds
-- two users rows with auth_user_id/email/invite_token all NULL by design,
-- then references them directly via raw INSERT (collected_by/paid_by),
-- bypassing the app. Scope the delete by the real invariant — no financial
-- row actually points at it — not by the auth_user_id proxy.
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
