-- invite_preview.matches_caller_email said TRUE for a no-email invite.
--
-- 20260729120000 wrote the comparison as:
--
--   i.email is not distinct from (select lower(btrim(u.email)) ... where u.id = auth.uid())
--
-- `is not distinct from` treats NULL as a value that equals itself. An anon
-- caller makes the subquery yield NULL, and a pre-v6 invite can have a NULL
-- email, so both sides go NULL and the function reports a match between two
-- addresses that do not exist.
--
-- Not currently user-visible: the client raises its mismatch confirm on
-- `!matchesCallerEmail && Boolean(inviteeEmailMasked)`, and a no-email
-- invite has nothing to mask, so the second condition suppresses the confirm
-- either way. The flag itself is still wrong, and it is the kind of wrong
-- that turns into a real bug the moment something trusts it alone — which is
-- exactly what a boolean named "matches_caller_email" invites.
--
-- coalesce(=, false) instead: NULL on either side is not a match.
--   invite email NULL   -> NULL = x   -> NULL -> false
--   caller email NULL   -> x = NULL   -> NULL -> false
--   both present, equal -> true
create or replace function invite_preview(token text)
returns table (mandal_name text, role text, invitee_name text,
               invitee_email_masked text, matches_caller_email boolean)
language sql stable security definer set search_path = public, auth, extensions as $$
  select m.name, i.role, i.name, mask_email(i.email),
         coalesce(
           i.email = (select lower(btrim(u.email)) from auth.users u where u.id = auth.uid()),
           false
         )
  from invites i
  join mandals m on m.id = i.mandal_id
  where (
      i.token_hash = encode(extensions.digest(invite_preview.token, 'sha256'), 'hex')
      or i.code = normalize_invite_code(invite_preview.token)
    )
    and i.consumed_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  limit 1
$$;
