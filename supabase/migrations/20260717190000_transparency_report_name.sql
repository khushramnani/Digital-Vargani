-- The public transparency report is the page the landing "See a sample
-- report →" CTA opens, and its whole point is to say WHICH mandal is
-- accounting for its money. The report was addressed by slug but never
-- returned the mandal's own name, so the page had nothing but the slug to
-- title itself with (a title-cased "demo" for the flagship demo mandal).
--
-- Return the name from get_transparency_report. No new exposure: the function
-- already gates every row on `transparency_published or (is_admin() and own
-- mandal)`, so the name comes back only for a report that is already public
-- (or to that mandal's own admin previewing it). An unknown or unpublished
-- slug still returns zero rows — no name, same as before.

drop function get_transparency_report(text);
create or replace function get_transparency_report(mandal_slug text)
returns table (mandal_name text, total_collected_paise bigint, total_expenses_paise bigint)
language sql stable security definer set search_path = public as $$
  with m as (select id, name, transparency_published from mandals where slug = mandal_slug)
  select
    m.name,
    coalesce((select sum(amount_paise) from donations
               where not voided and mandal_id = (select id from m)), 0),
    coalesce((select sum(amount_paise) from expenses
               where not voided and mandal_id = (select id from m)), 0)
  from m
  where m.transparency_published or (is_admin() and app_mandal_id() = m.id)
$$;

revoke execute on function get_transparency_report(text) from public;
grant execute on function get_transparency_report(text) to anon, authenticated;
