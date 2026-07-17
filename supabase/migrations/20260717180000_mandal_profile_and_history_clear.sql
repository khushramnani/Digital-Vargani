-- Mandal profile fields (state / address / creator phone) + an admin
-- "clear donation history". Three additions, one migration:
--   1. mandals gains state/address/creator_phone.
--   2. create_mandal captures state (+ optional address) at signup.
--   3. clear_donation_history() bulk-voids a mandal's donations.

-- ── New profile columns ────────────────────────────────────────────────
-- All nullable: the existing mandals (the original VYM row + the demo)
-- predate these fields and must keep working, so the implicit backfill is a
-- no-op. The onboarding UI makes state required for NEW mandals; the DB
-- stays permissive rather than adding a NOT NULL that the old rows'd fail.
alter table mandals
  add column state         text,
  add column address       text,
  add column creator_phone text;

-- ── Self-serve signup now captures state + address ─────────────────────
-- Drop-and-recreate (not create-or-replace) because the argument list
-- changes — two optional params join the end. The body is verbatim from the
-- multi-tenancy migration except the mandals insert, which now carries
-- state/address (nullif'd so a blank field lands as NULL, not '').
drop function create_mandal(text, text, text);
create or replace function create_mandal(
  mandal_name    text,
  admin_name     text,
  slug_hint      text default null,
  mandal_state   text default null,
  mandal_address text default null
)
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

  if exists (select 1 from users where auth_user_id = auth.uid()) then
    raise exception 'this account already belongs to a mandal';
  end if;

  if exists (select 1 from users where email = my_email) then
    raise exception 'this email was already invited to a mandal; open your invite link instead';
  end if;

  base := left(coalesce(
    nullif(slugify(slug_hint), ''),
    nullif(slugify(mandal_name), ''),
    'mandal'
  ), 40);
  candidate := base;

  loop
    begin
      insert into mandals (name, slug, state, address)
        values (
          mandal_name,
          candidate,
          nullif(btrim(mandal_state), ''),
          nullif(btrim(mandal_address), '')
        )
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

revoke execute on function create_mandal(text, text, text, text, text) from public;
grant execute on function create_mandal(text, text, text, text, text) to authenticated;

-- ── Admin: clear the donation ledger ───────────────────────────────────
-- Deleting one wrong donation is already the per-row void every donation
-- has (voidRow / the collections screen). This is its bulk sibling: void
-- every not-yet-voided donation in the caller's mandal in one shot, for when
-- the whole ledger was a false start (a test run, a demo) and the admin
-- wants a clean slate.
--
-- Void, not DELETE, on purpose. This is a transparency ledger; the
-- append-only design (there is no DELETE policy on donations anywhere) is
-- exactly what lets a mandal prove it never quietly erased a donor. Voided
-- rows drop out of every total, the dashboard and the public report (see
-- reconcile.ts and get_transparency_report), so the ledger reads as empty
-- while the audit trail survives. SECURITY DEFINER because a volunteer has
-- no update policy over other people's rows; the is_admin() gate is the real
-- authorization, and the mandal_id predicate keeps it to the caller's books.
create or replace function clear_donation_history(reason text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  me      uuid := app_user_id();
  cleared integer;
begin
  if not is_admin() then
    raise exception 'only an admin can clear the donation history';
  end if;

  update donations
     set voided      = true,
         void_reason = coalesce(nullif(btrim(reason), ''), 'Cleared by admin'),
         voided_by   = me,
         voided_at   = now()
   where mandal_id = app_mandal_id()
     and not voided;

  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

revoke execute on function clear_donation_history(text) from public;
grant execute on function clear_donation_history(text) to authenticated;
