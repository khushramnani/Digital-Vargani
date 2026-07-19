-- Audit 2026-07-19 v2 — schema + RPC wave (Wave C: F5, F6, F7, F3 name field,
-- and new-issue #3 active-user gate).
--
-- Every change here is additive and backward-compatible: new mandals columns
-- are nullable or defaulted so existing rows are untouched, and
-- transparency_visibility defaults to 'public' — i.e. the current
-- "published => anyone with the link" behaviour is preserved until an admin
-- narrows it. The transparency RPCs layer visibility ON TOP of the existing
-- transparency_published toggle: a report must be BOTH published AND admit the
-- caller. app_user_id()/app_user_role()/app_mandal_id() gain an `active` gate so
-- a deactivated user (volunteer or admin) is fully locked out, not just hidden
-- from lists.

-- ── mandals: new columns ─────────────────────────────────────────────────

-- F7: city, paired with the existing free-text `state`. Plain nullable text,
-- same as state/address (an old mandal may have none). The signup city
-- typeahead fills both city and state; settings can edit them.
alter table mandals add column city text;

-- F3: the president's name, shown under the (larger) signature on the public
-- receipt as "<name>" + a "President" label. Nullable — when unset the receipt
-- shows the label alone, exactly as it does today.
alter table mandals add column president_name text;

-- F5: who may see the published transparency report. Layered on top of
-- transparency_published (publishing stays a separate toggle):
--   public   — anyone with the link (today's behaviour, the default)
--   members  — signed-in as any member (admin OR volunteer) of THIS mandal
--   admins   — admins of THIS mandal only
--   disabled — nobody via the public path (a friendly "not available")
-- The admin-of-own-mandal preview always bypasses this (the admin transparency
-- screen must render regardless), same as the publish gate does today.
alter table mandals
  add column transparency_visibility text not null default 'public'
    check (transparency_visibility in ('public', 'members', 'admins', 'disabled'));

-- F6: inquiry contacts shown on the public receipt footer. A JSON array of
-- { "name": text, "phone": text } (max 2, enforced in the settings UI). The
-- president (president_name + creator_phone) is the implicit default contact;
-- hide_president_contact drops it — but the UI/receipt still shows the president
-- when no other contact exists (there must always be someone to ask). These
-- numbers are deliberately public to anyone with a receipt link.
alter table mandals add column inquiry_contacts jsonb not null default '[]'::jsonb;
alter table mandals add column hide_president_contact boolean not null default false;

-- ── new-issue #3: lock deactivated users out at the source ───────────────
-- app_user_id/app_user_role/app_mandal_id all resolve the acting user from
-- auth.uid(). None checked users.active, so a deactivated volunteer's live
-- session kept full collect/void access, and a deactivated admin kept is_admin()
-- and a valid mandal scope. Gating ALL THREE on `active` is the root-cause fix:
-- gating only app_user_id() would leave is_admin() (via app_user_role) and the
-- tenant scope (app_mandal_id) live for a deactivated admin. list_admins()
-- already treats `active` as an access gate — this extends that consistently.
create or replace function app_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid() and active
$$;

create or replace function app_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from users where auth_user_id = auth.uid() and active
$$;

create or replace function app_mandal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select mandal_id from users where auth_user_id = auth.uid() and active
$$;

-- ── F3 + F6: public receipt now carries mandal contact fields ────────────
-- security definer, so it reads mandals freely and returns exactly what anon
-- sees. The new fields (city, president_name, creator_phone, inquiry_contacts,
-- hide_president_contact) are all deliberately public — unlike donor_phone,
-- which this function has never returned. The client applies the "hide president
-- unless it's the only contact" display rule.
drop function get_public_receipt(text);
create or replace function get_public_receipt(token text)
returns table (
  receipt_no             bigint,
  donor_name             text,
  amount_paise           bigint,
  mode                   text,
  created_at             timestamptz,
  voided                 boolean,
  void_reason            text,
  mandal_name            text,
  logo_url               text,
  signature_url          text,
  receipt_prefix         text,
  city                   text,
  president_name         text,
  creator_phone          text,
  inquiry_contacts       jsonb,
  hide_president_contact boolean
)
language sql stable security definer set search_path = public as $$
  select d.receipt_no, d.donor_name, d.amount_paise, d.mode, d.created_at,
         d.voided, d.void_reason,
         m.name, m.logo_url, m.signature_url, m.receipt_prefix,
         m.city, m.president_name, m.creator_phone, m.inquiry_contacts, m.hide_president_contact
  from donations d
  join mandals m on m.id = d.mandal_id
  where d.public_token = token
  limit 1
$$;

revoke execute on function get_public_receipt(text) from public;
grant execute on function get_public_receipt(text) to anon, authenticated;

-- ── F5: transparency RPCs honour transparency_visibility ─────────────────
-- The two functions are kept in lockstep by design — the gate is IDENTICAL in
-- both. A report is visible when it is published AND its visibility admits the
-- caller, OR the caller is an admin of that same mandal (the always-on preview
-- the admin transparency screen relies on). anon has app_mandal_id() = null, so
-- 'members'/'admins'/'disabled' exclude anon automatically.
drop function get_transparency_report(text);
create or replace function get_transparency_report(mandal_slug text)
returns table (mandal_name text, total_collected_paise bigint, total_expenses_paise bigint, donor_count bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select id, name, transparency_published, transparency_visibility
    from mandals where slug = mandal_slug
  )
  select
    m.name,
    coalesce((select sum(amount_paise) from donations
               where not voided and mandal_id = (select id from m)), 0),
    coalesce((select sum(amount_paise) from expenses
               where not voided and mandal_id = (select id from m)), 0),
    -- F5 design: "across N families" — the count of non-voided donations for
    -- this mandal (kept aggregate-only, no donor identities are exposed).
    coalesce((select count(*) from donations
               where not voided and mandal_id = (select id from m)), 0)
  from m
  where (
      m.transparency_published and (
        m.transparency_visibility = 'public'
        or (m.transparency_visibility = 'members' and m.id = app_mandal_id())
        or (m.transparency_visibility = 'admins' and is_admin() and m.id = app_mandal_id())
      )
    )
    or (is_admin() and app_mandal_id() = m.id)
$$;

revoke execute on function get_transparency_report(text) from public;
grant execute on function get_transparency_report(text) to anon, authenticated;

drop function get_transparency_categories(text);
create or replace function get_transparency_categories(mandal_slug text)
returns table (category text, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select id, transparency_published, transparency_visibility
    from mandals where slug = mandal_slug
  )
  select e.category, sum(e.amount_paise)
  from expenses e, m
  where not e.voided
    and e.mandal_id = m.id
    and (
      (
        m.transparency_published and (
          m.transparency_visibility = 'public'
          or (m.transparency_visibility = 'members' and m.id = app_mandal_id())
          or (m.transparency_visibility = 'admins' and is_admin() and m.id = app_mandal_id())
        )
      )
      or (is_admin() and app_mandal_id() = m.id)
    )
  group by e.category
$$;

revoke execute on function get_transparency_categories(text) from public;
grant execute on function get_transparency_categories(text) to anon, authenticated;

-- ── F7: create_mandal accepts a city ─────────────────────────────────────
-- The arg list changes, so drop-and-recreate (Postgres can't `create or
-- replace` across a signature change — every prior migration in this chain
-- does the same). mandal_city is appended last to stay append-only, mirroring
-- how mandal_state/mandal_address were added, and lands via the same
-- nullif(btrim(...)) blank-to-null treatment.
drop function create_mandal(text, text, text, text, text);
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

  -- Volunteer sessions are anonymous (signInAnonymously) and must never be
  -- able to create a mandal.
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

  -- Prefer the founder's chosen slug; fall back to the mandal name; fall back
  -- to 'mandal' when neither yields any ASCII (a wholly-Devanagari name AND no
  -- hint).
  base := coalesce(
    nullif(slugify(slug_hint), ''),
    nullif(slugify(mandal_name), ''),
    'mandal'
  );

  -- Floor: the constraint needs at least 2 characters. 'A' -> 'a' -> 'a-mandal'.
  if length(base) < 2 then
    base := base || '-mandal';
  end if;

  -- Ceiling: 40. rtrim in case truncation lands mid-word on a hyphen.
  base := rtrim(left(base, 40), '-');
  candidate := base;

  loop
    begin
      insert into mandals (name, slug, state, address, city)
        values (
          mandal_name,
          candidate,
          nullif(btrim(mandal_state), ''),
          nullif(btrim(mandal_address), ''),
          nullif(btrim(mandal_city), '')
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
      -- Reserve room for the suffix inside the 40-char ceiling.
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
