-- Follow-up to 20260717120000_multi_tenancy.sql (already applied, so this is
-- a new migration rather than an amendment).
--
-- mandal_id was added as `not null` with no default. Two consequences, one
-- cosmetic and one real:
--
--   1. Supabase's type generator marks a not-null-no-default column as
--      REQUIRED in the generated Insert type. So every insert call site had
--      to pass mandal_id — directly contradicting the rule that the client
--      never supplies it (enforce_insert_defaults stamps it from the
--      session). Giving the column a default makes it optional in Insert,
--      the same way created_at/voided/id already are.
--
--   2. `users` has NO insert trigger — only donations/expenses/handovers do.
--      So an admin inviting a volunteer (settings/volunteers.tsx) or another
--      admin (settings/admins.tsx) genuinely had nowhere for mandal_id to
--      come from except the client. This default fixes that properly: the
--      new user lands in the inviting admin's mandal, decided server-side.
--      users_admin_insert's `with check (mandal_id = app_mandal_id())` then
--      validates it, so an admin still cannot invite into another mandal.
--
-- This does not weaken the forgery guarantee. A DEFAULT only applies when
-- the column is omitted; enforce_insert_defaults still overwrites whatever
-- a client sends for donations/expenses/handovers, and RLS's WITH CHECK is
-- what rejects a forged mandal_id on users.

alter table users     alter column mandal_id set default app_mandal_id();
alter table donations alter column mandal_id set default app_mandal_id();
alter table expenses  alter column mandal_id set default app_mandal_id();
alter table handovers alter column mandal_id set default app_mandal_id();
