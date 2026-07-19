-- Plan v4 follow-up: group the donor directory on a NORMALIZED phone.
--
-- donors_summary keyed donors on the raw stored donor_phone. v4 introduced
-- E.164 storage (PhoneInput), so the same person now has a pre-v4 row saved as
-- '9876543210' and a post-v4 row saved as '+919876543210' — and the directory
-- split them into two donors with half the total each, while the dashboard's
-- "unique donors" stat counted them once (it normalizes client-side). The one
-- screen whose whole purpose is "who gave what, this year and last" disagreed
-- with the ledger, precisely at the migration boundary this release creates.
--
-- normalize_phone_e164 mirrors src/lib/phone.ts normalizeToE164 exactly, so the
-- server's grouping and the client's history filter can never drift.

create or replace function normalize_phone_e164(raw text) returns text
language sql immutable as $$
  with cleaned as (
    select
      btrim(coalesce(raw, ''))                              as trimmed,
      regexp_replace(coalesce(raw, ''), '\D', '', 'g')      as digits
  ),
  national as (
    -- '00' is the international ACCESS prefix; a remaining leading '0' is a
    -- national TRUNK prefix. Neither belongs to the international number.
    select
      trimmed,
      digits,
      regexp_replace(regexp_replace(digits, '^00', ''), '^0+', '') as n
    from cleaned
  )
  select case
    when trimmed = '' or digits = ''       then null
    -- Already international: keep it, just re-strip separators.
    when trimmed like '+%'                 then '+' || digits
    when n = ''                            then null
    -- The one surviving legacy assumption: a bare 10-digit number is an Indian
    -- mobile missing its +91 (matches phone.ts).
    when length(n) = 10                    then '+91' || n
    else '+' || n
  end
  from national
$$;

-- Same signature/columns as before — only the grouping key and the returned
-- phone change (both now normalized).
create or replace function donors_summary(p_year int default null)
returns table (
  donor_key      text,
  donor_name     text,
  donor_phone    text,
  total_paise    bigint,
  donation_count bigint,
  first_at       timestamptz,
  last_at        timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(normalize_phone_e164(donor_phone), lower(btrim(donor_name)))        as donor_key,
    (array_agg(donor_name order by created_at desc))[1]                          as donor_name,
    (array_agg(normalize_phone_e164(donor_phone) order by created_at desc)
       filter (where normalize_phone_e164(donor_phone) is not null))[1]          as donor_phone,
    sum(amount_paise)::bigint                                                     as total_paise,
    count(*)::bigint                                                             as donation_count,
    min(created_at)                                                              as first_at,
    max(created_at)                                                              as last_at
  from donations
  where mandal_id = app_mandal_id()
    and is_admin()
    and not voided
    and (p_year is null or extract(year from created_at)::int = p_year)
  group by coalesce(normalize_phone_e164(donor_phone), lower(btrim(donor_name)))
  order by sum(amount_paise) desc
$$;

revoke execute on function donors_summary(int) from public;
grant execute on function donors_summary(int) to authenticated;
