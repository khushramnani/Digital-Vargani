-- Regression fix surfaced by verify-local.sh (audit 2026-07-18 #7).
--
-- 20260717160000_slug_length_bounds.sql fixed create_mandal so a legal name
-- never raises a raw check_violation: it padded a sub-2-char slug up to the
-- floor and reserved room for the collision suffix under the 40-char ceiling.
-- 20260717180000_mandal_profile_and_history_clear.sql then re-published
-- create_mandal (to add the state/address params) from the OLD body and
-- dropped both guards — reintroducing the exact bug 160000 fixed (a mandal
-- named 'A' -> slug 'a' -> check_violation the retry loop doesn't catch).
--
-- Re-publish the current 5-arg signature with the slug-bounds logic restored.

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

revoke execute on function create_mandal(text, text, text, text, text) from public;
grant execute on function create_mandal(text, text, text, text, text) to authenticated;
