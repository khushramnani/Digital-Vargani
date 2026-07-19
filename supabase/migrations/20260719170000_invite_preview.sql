-- Let the invite page name the mandal BEFORE a session exists, and tell a bad
-- token apart from a failed sign-in.
--
-- /invite/:token is pre-auth: the visitor has no session, so RLS gives them
-- nothing and the page could not say who invited them or to which mandal. It
-- also could not tell "this link is invalid" from "we could not create a
-- session" — both rendered the same "invalid or already-used" screen, which
-- misdiagnosed a disabled anonymous-sign-in provider as a broken link.
--
-- SECURITY DEFINER + granted to anon because the caller has no session by
-- definition. Safe by construction, exactly like get_public_receipt: it is
-- addressed by an unguessable one-time token, returns at most one row, and
-- exposes only the mandal's own (already public) display name plus the invited
-- volunteer's name. A REDEEMED or unknown token returns zero rows, so this
-- leaks nothing about which tokens ever existed.
create or replace function invite_preview(token text)
returns table (mandal_name text, volunteer_name text)
language sql stable security definer set search_path = public as $$
  select m.name, u.name
  from users u
  join mandals m on m.id = u.mandal_id
  where u.invite_token = token
    and u.role = 'volunteer'
    and u.auth_user_id is null
  limit 1
$$;

revoke execute on function invite_preview(text) from public;
grant execute on function invite_preview(text) to anon, authenticated;
