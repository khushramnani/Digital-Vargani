-- list_admins() still filtered role = 'admin' after the owner role was
-- added (20260720120000/20260720130000) — the owner, likely the ONLY
-- non-volunteer in a small mandal, was silently excluded from the cash
-- handover recipient picker (src/lib/db/handovers.ts's getAdmins(), which
-- feeds handovers.received_by — this RPC's result IS the enforcement of
-- who can receive cash, since that column has no role constraint of its
-- own). Widen to match is_admin()'s own definition.
create or replace function list_admins()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from users
  where role in ('owner', 'admin') and active and mandal_id = app_mandal_id()
$$;

revoke execute on function list_admins() from public;
grant execute on function list_admins() to authenticated;
