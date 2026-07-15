-- Task 12: volunteers currently have no way to discover who the admin is.
-- `handovers.received_by` needs to reference an admin user, but Task 2's RLS
-- only lets a volunteer SELECT their OWN `users` row (`users_self_select`),
-- not other users. Rather than broadening the sensitive `users` table's RLS,
-- add one small, narrowly-scoped SECURITY DEFINER RPC — same pattern as
-- get_public_receipt/link_admin_account/redeem_invite. Exposes only id+name
-- for active admins, nothing else (no email, no phone), and only to a
-- logged-in caller (authenticated, not anon — the public has no reason to
-- see mandal membership).
create or replace function list_admins()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from users where role = 'admin' and active
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, which
-- would let anon call this too — revoke that before granting narrowly.
revoke execute on function list_admins() from public;
grant execute on function list_admins() to authenticated;
