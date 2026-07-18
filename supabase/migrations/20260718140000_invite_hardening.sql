-- Audit 2026-07-18 #4 (invite re-issue) + #5 (redeem hardening).
--
-- #4: a volunteer whose anonymous session is lost (cleared storage, new
-- phone) is locked out — tokens are one-time and the admin screen had no way
-- to reissue. reissue_invite() gives an admin a fresh link per volunteer and
-- clears the old binding so the volunteer can re-redeem.
--
-- #5: redeem_invite() trusted the client — unlike its mirror create_mandal()
-- (which rejects anonymous sessions), it asserted nothing about the session.
-- Assert the inverse here: redemption is the volunteer flow, always an
-- anonymous session.

-- ── Admin: reissue a volunteer's invite ─────────────────────────────────
create or replace function reissue_invite(volunteer_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  new_token text;
begin
  if not is_admin() then
    raise exception 'only an admin can reissue invites';
  end if;

  new_token := encode(extensions.gen_random_bytes(16), 'hex');

  -- Clearing auth_user_id invalidates the old (anonymous) binding so a
  -- volunteer who lost that session can redeem the fresh link and re-bind;
  -- the orphaned anon identity is harmless. Scoped to the admin's own mandal.
  update users
     set invite_token = new_token, auth_user_id = null
   where id = volunteer_id
     and mandal_id = app_mandal_id()
     and role = 'volunteer';

  if not found then
    raise exception 'volunteer not found in your mandal';
  end if;

  return new_token;
end;
$$;

revoke execute on function reissue_invite(uuid) from public;
grant execute on function reissue_invite(uuid) to authenticated;

-- ── redeem_invite: assert the session type ──────────────────────────────
create or replace function redeem_invite(token text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- The volunteer flow calls signInAnonymously() before redeeming, so a real
  -- (non-anonymous) session here is never the intended caller. Reject it —
  -- create_mandal() makes the mirror-image assertion.
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'invite links are redeemed by a volunteer session';
  end if;

  update users
  set auth_user_id = auth.uid(), invite_token = null
  where invite_token = token and role = 'volunteer' and auth_user_id is null;

  if not found then
    raise exception 'invalid or already-used invite link';
  end if;
end;
$$;

grant execute on function redeem_invite(text) to authenticated;
