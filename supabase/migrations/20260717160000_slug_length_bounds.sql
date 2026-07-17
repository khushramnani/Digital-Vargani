-- create_mandal could raise a raw check_violation on legal mandal names.
--
-- mandals.slug is constrained to '^[a-z0-9][a-z0-9-]{1,39}$' — 2 to 40
-- characters. The original create_mandal honoured the ceiling (left(…, 40))
-- but not the floor, and re-broke the ceiling when suffixing:
--
--   1. A one-character name ('A') slugified to 'a' — one char, below the
--      floor. The INSERT raised check_violation, which the retry loop does
--      not catch (it only handles unique_violation), so a founder saw a raw
--      Postgres constraint error.
--   2. A 40-char base that collided became base || '-2' = 42 chars — back
--      over the ceiling, same unhandled check_violation. Two mandals sharing
--      a long name is not exotic: 'Shri Ganesh Mitra Mandal Sarvajanik Trust
--      Pune' is 46 characters before slugifying.
--
-- Both are fixed by clamping to the constraint's real bounds rather than
-- only its upper one, and by reserving room for the suffix INSIDE the
-- ceiling instead of appending past it.

create or replace function create_mandal(mandal_name text, admin_name text, slug_hint text default null)
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
  -- name AND no hint).
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

  -- Try base, then base-2, base-3 … A concurrent signup racing for the same
  -- slug loses the insert, lands here, and retries the next candidate rather
  -- than producing a duplicate. Bounded, then a random suffix.
  loop
    begin
      insert into mandals (name, slug) values (mandal_name, candidate)
      returning id into new_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      if suffix > 50 then
        sfx := '-' || substr(gen_random_uuid()::text, 1, 6);
      else
        sfx := '-' || suffix;
      end if;
      -- Reserve room for the suffix inside the 40-char ceiling rather than
      -- appending past it.
      candidate := rtrim(left(base, 40 - length(sfx)), '-') || sfx;
    end;
  end loop;

  insert into users (mandal_id, name, email, role, auth_user_id, active)
  values (new_id, admin_name, my_email, 'admin', auth.uid(), true);

  return new_id;
end;
$$;

revoke execute on function create_mandal(text, text, text) from public;
grant execute on function create_mandal(text, text, text) to authenticated;
