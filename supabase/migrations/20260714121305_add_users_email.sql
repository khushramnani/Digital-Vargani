-- Task 4: admin auth (email magic link).
--
-- users has no email column yet, but admin login is by email — there is no
-- other way to know which `users` row a freshly-created Supabase Auth
-- account belongs to. Additive on top of Task 2's schema (20260714111950).

alter table users add column email text unique;

-- Chicken-and-egg problem this closes: when an admin requests a magic link,
-- Supabase creates (or reuses) a row in auth.users keyed by email —
-- completely separately from our `users` table. Nothing links them yet on
-- first login. RLS (from Task 2) requires `users.auth_user_id = auth.uid()`
-- to resolve a role via is_admin(), so a just-authenticated admin whose
-- `users.auth_user_id` is still null can't run the linking UPDATE
-- themselves. This SECURITY DEFINER RPC runs with elevated privileges
-- specifically for that one-time linking step.
create or replace function link_admin_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  my_email text;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then
    raise exception 'no authenticated user';
  end if;

  update users
  set auth_user_id = auth.uid()
  where email = my_email and role = 'admin' and auth_user_id is null;
end;
$$;

grant execute on function link_admin_account() to authenticated;
