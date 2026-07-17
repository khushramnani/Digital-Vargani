-- The language a mandal's receipts default to. Without it a Marathi mandal's
-- volunteers would pick Marathi on every single donation — and SPEC.md's
-- criterion 1 (≤3 taps to the SMS composer) means the picker must cost zero
-- taps when the default is already right.
alter table mandals add column default_lang text not null default 'en'
  check (default_lang in ('en','mr','hi','gu'));

-- Volunteers have no read access to mandals (mandals_admin_select is
-- admin-only), but the collection form needs this to preset its picker.
-- Same narrowly-scoped SECURITY DEFINER shape as get_expense_categories():
-- exposes exactly one column of exactly the caller's own mandal.
create or replace function get_mandal_default_lang() returns text
language sql stable security definer set search_path = public as $$
  select default_lang from mandals where id = app_mandal_id()
$$;

-- Postgres grants EXECUTE to PUBLIC on creation; revoke before granting.
revoke execute on function get_mandal_default_lang() from public;
grant execute on function get_mandal_default_lang() to authenticated;
