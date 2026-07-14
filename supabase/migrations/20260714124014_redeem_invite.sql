-- Task 5: volunteer invite-link auth.
--
-- Volunteers never get a password/OTP. Instead: an admin creates the
-- `users` row up front with a random `invite_token`; the app has the
-- volunteer's browser call `supabase.auth.signInAnonymously()` (fresh
-- anon auth.users row + session, no identity info yet), then this
-- SECURITY DEFINER RPC binds that anonymous auth identity to the invited
-- row by matching `invite_token` — the same link-on-first-use shape as
-- Task 4's `link_admin_account()`, keyed by token instead of email.
--
-- Single-use by design: redemption nulls invite_token, so the same link
-- can't be replayed by someone else afterward. `authenticated` only (not
-- `anon`) — the caller must already have a session from
-- signInAnonymously() before redeeming, so auth.uid() resolves to
-- something.
create or replace function redeem_invite(token text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  update users
  set auth_user_id = auth.uid(), invite_token = null
  where invite_token = token and role = 'volunteer' and auth_user_id is null;

  if not found then
    raise exception 'invalid or already-used invite link';
  end if;
end;
$$;

grant execute on function redeem_invite(text) to authenticated;
