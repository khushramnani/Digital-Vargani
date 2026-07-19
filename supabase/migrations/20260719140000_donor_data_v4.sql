-- Plan v4 — donor data: donation source category, president-name prefill,
-- donor directory aggregate, and the first true hard-delete (purge) path.

-- ── 1. donations.category (society / shop / other) ───────────────────────
-- Where the money came from — door-to-door society flats, shops, or ad-hoc.
-- Existing rows become 'society' (the dominant case; documented). Like every
-- other financial field it is append-only: a wrong category is a void + re-enter.
alter table donations
  add column category text not null default 'society'
    check (category in ('society', 'shop', 'other'));

-- ── 2. append-only guard now covers category ─────────────────────────────
-- Republished in full (three triggers reference it by name); verbatim from
-- 20260718120000 plus `category` in the donations block. The void-integrity
-- block at the top is unchanged.
create or replace function forbid_financial_edit() returns trigger
language plpgsql as $$
begin
  -- Void columns changing at all?
  if new.voided     is distinct from old.voided
     or new.void_reason is distinct from old.void_reason
     or new.voided_by   is distinct from old.voided_by
     or new.voided_at   is distinct from old.voided_at then
    if current_setting('app.voiding', true) is distinct from 'on' then
      raise exception 'void metadata is set only by void_row()';
    end if;
    if old.voided then
      raise exception 'a voided row cannot be changed';
    end if;
    if not new.voided then
      raise exception 'void is one-way';
    end if;
  end if;

  if TG_TABLE_NAME = 'donations' then
    if new.donor_name <> old.donor_name
       or new.donor_phone is distinct from old.donor_phone
       or new.amount_paise <> old.amount_paise
       or new.mode <> old.mode
       or new.category is distinct from old.category
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

-- ── 3. create_mandal prefills president_name from the founder's name ──────
-- Same 6-arg signature (create-or-replace, no drop) — only the mandals INSERT
-- changes: president_name seeds from admin_name so a brand-new receipt shows a
-- real person under the signature instead of the mandal name (plan v4 §4/§5).
-- The admin can edit it in Settings afterwards.
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

  if exists (select 1 from users where auth_user_id = auth.uid()) then
    raise exception 'this account already belongs to a mandal';
  end if;

  if exists (select 1 from users where email = my_email) then
    raise exception 'this email was already invited to a mandal; open your invite link instead';
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
  values (new_id, admin_name, my_email, 'admin', auth.uid(), true);

  return new_id;
end;
$$;

revoke execute on function create_mandal(text, text, text, text, text, text) from public;
grant execute on function create_mandal(text, text, text, text, text, text) to authenticated;

-- ── 4. donors_summary: admin donor directory aggregate ───────────────────
-- Groups this mandal's NON-voided donations by donor identity (phone when
-- present, else the lower-cased name) so the admin can answer "who gave what".
-- SECURITY DEFINER + is_admin()/app_mandal_id() gate (RLS is bypassed for a
-- definer, so the scope is enforced in the WHERE) — a volunteer or another
-- mandal's admin gets zero rows. Optional year filter for cross-season lookups.
-- Aggregate only; never returns per-donation rows or amounts to non-admins.
create or replace function donors_summary(p_year int default null)
returns table (
  donor_key      text,
  donor_name     text,
  donor_phone    text,
  total_paise    bigint,
  donation_count bigint,
  first_at       timestamptz,
  last_at        timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(btrim(donor_phone), ''), lower(btrim(donor_name)))          as donor_key,
    (array_agg(donor_name order by created_at desc))[1]                          as donor_name,
    (array_agg(donor_phone order by created_at desc)
       filter (where nullif(btrim(donor_phone), '') is not null))[1]             as donor_phone,
    sum(amount_paise)::bigint                                                     as total_paise,
    count(*)::bigint                                                             as donation_count,
    min(created_at)                                                              as first_at,
    max(created_at)                                                              as last_at
  from donations
  where mandal_id = app_mandal_id()
    and is_admin()
    and not voided
    and (p_year is null or extract(year from created_at)::int = p_year)
  group by coalesce(nullif(btrim(donor_phone), ''), lower(btrim(donor_name)))
  order by sum(amount_paise) desc
$$;

revoke execute on function donors_summary(int) from public;
grant execute on function donors_summary(int) to authenticated;

-- ── 5. purge_donations: the first hard DELETE in the schema ──────────────
-- Everyday cleanup stays a soft void (clear_donation_history); this is the
-- separate, scarier PERMANENT erase. SECURITY DEFINER so it can DELETE at all
-- (there is deliberately no DELETE RLS policy — a raw client still cannot
-- delete a financial row); authorization is the explicit is_admin() +
-- mandal-scope guard, mirroring void_row().
--   'removed' — erase only already-voided rows (empty the "removed" history)
--   'all'     — erase the mandal's entire donation history (year reset / test wipe)
-- Purged public_tokens 404 afterwards — that is the point.
create or replace function purge_donations(scope text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m      uuid := app_mandal_id();
  purged integer;
begin
  if not is_admin() or m is null then
    raise exception 'only an admin can purge donation history';
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

revoke execute on function purge_donations(text) from public;
grant execute on function purge_donations(text) to authenticated;
