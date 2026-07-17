-- Multi-tenancy: mandal_config (a boolean-PK singleton) becomes mandals, and
-- every table gains a mandal_id tenant key. See
-- docs/superpowers/specs/2026-07-17-multi-tenancy-design.md.
--
-- Ordering is load-bearing: copy mandal_config's row into mandals BEFORE
-- adding NOT NULL columns that reference it, and backfill next_receipt_no
-- from max(receipt_no) BEFORE dropping the global sequence. A half-applied
-- version of this file is a cross-tenant data leak, so it is one migration.

-- ── mandals ─────────────────────────────────────────────────────────────

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

-- ── The tenant key ─────────────────────────────────────────────────────
-- Mirrors app_user_id()/app_user_role() from the base migration. Every
-- policy and every mandal-scoped RPC reads the caller's mandal through
-- this one function — one place to reason about, one place to get wrong.
create or replace function app_mandal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select mandal_id from users where auth_user_id = auth.uid()
$$;

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
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Whenever there IS a session, it wins — a client cannot forge mandal_id.
  -- app_mandal_id() is null only for a caller with no `users` row: either
  -- the table owner doing test-data/seed setup (which bypasses RLS anyway,
  -- so the fallback grants nothing that wasn't already granted), or a
  -- session that isn't a member of any mandal — and every insert policy
  -- requires app_user_id()/is_admin(), so RLS rejects that caller before
  -- the fallback could matter.
  new.mandal_id := coalesce(app_mandal_id(), new.mandal_id);

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

-- ── RLS: mandals ───────────────────────────────────────────────────────
-- No INSERT policy: mandals are created only through create_mandal()
-- (SECURITY DEFINER, below). No DELETE policy anywhere, same as every
-- other table.
alter table mandals enable row level security;

create policy mandals_admin_select on mandals for select
  using (is_admin() and id = app_mandal_id());
create policy mandals_admin_update on mandals for update
  using (is_admin() and id = app_mandal_id())
  with check (is_admin() and id = app_mandal_id());

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

-- ── Self-serve signup ──────────────────────────────────────────────────
-- The only way a mandal is ever created. SECURITY DEFINER because the
-- caller has no `users` row yet, so no policy can apply to them: they are
-- not a member of anything at the moment they call this.
-- slug_hint lets the founder choose their own public link. It matters more
-- than it looks: slugify() is ASCII-only, so a mandal named गणेश मंडळ —
-- i.e. the target market — slugifies to '' and would otherwise land on
-- 'mandal', 'mandal-2', 'mandal-3'… defeating the entire point of having a
-- readable link to paste into a WhatsApp group. The hint is slugified and
-- uniqueness-checked like any other candidate; it is not trusted raw.
create or replace function create_mandal(mandal_name text, admin_name text, slug_hint text default null)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
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

  -- users.email is globally UNIQUE, so an email already invited elsewhere
  -- would fail the insert below with an opaque 23505. Say what to do.
  if exists (select 1 from users where email = my_email) then
    raise exception 'this email was already invited to a mandal; open your invite link instead';
  end if;

  -- Prefer the founder's chosen slug; fall back to the mandal name; fall
  -- back to 'mandal' when neither yields any ASCII (a wholly-Devanagari
  -- name AND no hint). Truncate before suffixing so the check constraint's
  -- 40-char bound can't be breached by a long name.
  base := left(coalesce(
    nullif(slugify(slug_hint), ''),
    nullif(slugify(mandal_name), ''),
    'mandal'
  ), 40);
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

revoke execute on function create_mandal(text, text, text) from public;
grant execute on function create_mandal(text, text, text) to authenticated;

-- ── Finally: the singleton is gone ─────────────────────────────────────
-- Every read of this table (the mandals backfill at the top of this file)
-- has already happened by now. Its policies drop with it.
drop table mandal_config;
