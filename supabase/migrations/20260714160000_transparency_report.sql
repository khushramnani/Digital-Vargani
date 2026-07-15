-- Task 16: public transparency report — total collected + spend-by-category,
-- with zero individual donor/expense rows ever reaching the client. Both
-- RPCs pre-aggregate server-side (same reasoning as get_public_receipt:
-- restrict what's exposed in the query itself, not by trusting the client
-- to only display safe fields) and are gated on mandal_config's new publish
-- flag — an admin can always preview (is_admin() bypasses the gate), but
-- anon/volunteer only ever see published data. An unpublished report
-- returns zero rows, not zeroed totals, so the client can tell "not
-- published yet" apart from "published, nothing collected yet".

alter table mandal_config add column transparency_published boolean not null default false;

create or replace function get_transparency_report()
returns table (total_collected_paise bigint, total_expenses_paise bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(amount_paise) from donations where not voided), 0),
    coalesce((select sum(amount_paise) from expenses where not voided), 0)
  where (select transparency_published from mandal_config) or is_admin()
$$;

create or replace function get_transparency_categories()
returns table (category text, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  select category, sum(amount_paise)
  from expenses
  where not voided
    and ((select transparency_published from mandal_config) or is_admin())
  group by category
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation (the
-- gap Task 12's list_admins() migration caught) — revoke that before
-- granting narrowly, even though this pair is meant for anon too.
revoke execute on function get_transparency_report() from public;
revoke execute on function get_transparency_categories() from public;
grant execute on function get_transparency_report() to anon, authenticated;
grant execute on function get_transparency_categories() to anon, authenticated;
