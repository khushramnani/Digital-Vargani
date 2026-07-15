-- mandal_config only has a mandal_config_admin_select RLS policy — a
-- volunteer has no read access to it at all. That silently breaks
-- ExpensesScreen (Task 11, reused at /volunteer/expenses) which calls
-- getMandalConfig() for the category dropdown: a real volunteer session
-- gets zero rows back from that select. Rather than broadening the whole
-- (admin-facing, includes bank_opening_paise/transparency_published) table
-- to every authenticated user, add one small, narrowly-scoped SECURITY
-- DEFINER RPC — same pattern as list_admins/get_transparency_report:
-- expose only expense_categories, nothing else.
create or replace function get_expense_categories()
returns text[]
language sql stable security definer set search_path = public as $$
  select expense_categories from mandal_config
$$;

revoke execute on function get_expense_categories() from public;
grant execute on function get_expense_categories() to authenticated;
