-- Every `revoke execute on function ... from public` in this repo has been
-- half-working on the hosted project since the first migration, and the
-- local harness could not see it.
--
-- Supabase ships `alter default privileges in schema public grant execute on
-- functions to anon, authenticated, service_role`. So a newly created
-- function gets an EXPLICIT grant to `anon` — and revoking from PUBLIC does
-- not touch an explicit role grant. Every RPC in this schema that was meant
-- to be authenticated-only has been callable by `anon` on prod all along:
--
--   curl .../rest/v1/rpc/donors_summary -H "apikey: <publishable>"  ->  200 []
--
-- Nothing leaked, which is why it went unnoticed: each of these is SECURITY
-- DEFINER with its own guard (is_admin(), app_mandal_id(), auth.uid() is
-- null), so an anon caller gets an empty set or an exception rather than
-- data. The bug is that the grant was never the control — the guard was —
-- while the migrations read as though the grant did the work. That is a
-- trap for the next function written here, so it gets closed explicitly.
--
-- Named RPCs only, deliberately NOT a blanket sweep of the schema. Helpers
-- like is_admin()/app_mandal_id() are referenced inside RLS policy
-- expressions, which are evaluated with the calling role's privileges — pull
-- anon's EXECUTE out from under those and an anon SELECT would raise
-- "permission denied for function" instead of quietly matching no rows.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname in (
        -- Membership + invites.
        'accept_invite', 'create_invite', 'resend_invite', 'revoke_invite',
        'list_pending_invites', 'my_pending_invites', 'set_member_role',
        'transfer_ownership', 'deactivate_member', 'reactivate_member',
        'list_admins',
        -- Invite-code helpers: minting one is not an anon concern.
        'gen_invite_code', 'next_invite_code',
        -- Mandal lifecycle + admin-only reads and destructive actions.
        'create_mandal', 'clear_donation_history', 'purge_donations',
        'donors_summary', 'get_expense_categories', 'get_mandal_default_lang',
        'void_row'
      )
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;

-- Deliberately still anon-callable, and must stay that way — each is a
-- public, pre-session surface: get_public_receipt (the donor's receipt link),
-- get_transparency_report / get_transparency_categories (the community
-- report), invite_preview (names the mandal before anyone has signed in).
