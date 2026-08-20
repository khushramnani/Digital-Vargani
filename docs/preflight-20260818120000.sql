-- READ-ONLY pre-flight for 20260818120000_custom_donation_sources.sql.
-- Paste into the Supabase SQL editor and run BEFORE `supabase db push`.
-- Every statement here is a SELECT. Nothing is created, altered or deleted.

-- 1. Which CHECK constraints exist on donations right now?
--    EXPECT exactly one whose definition mentions `category`, i.e.
--    check ((category = ANY (ARRAY['society','shop','other'])))
--    The migration's DO block finds it by that word. If TWO mention `category`,
--    stop and tell me — the block would drop only the first.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'donations'::regclass and contype = 'c'
order by conname;

-- 2. Could the NEW check (non-blank, <= 40 chars) reject any existing row?
--    EXPECT 0. If it is not 0, the migration would fail and roll back — no data
--    would be lost, but do not push until we know why.
select count(*) as rows_that_would_fail_new_check
from donations
where category is null or btrim(category) = '' or length(category) > 40;

-- 3. What is actually in donations.category today, across every mandal?
--    EXPECT only 'society' / 'shop' / 'other'.
select category, count(*) as rows
from donations
group by category
order by rows desc;

-- 4. Confirm the new column does not already exist (a re-run guard).
--    EXPECT 0 rows.
select column_name
from information_schema.columns
where table_name = 'mandals' and column_name = 'donation_sources';

-- 5. How many mandals will receive the default {Society,Shop,Other}?
--    Just so the number is expected, not a surprise.
select count(*) as mandals_affected from mandals;

-- ─────────────────────────────────────────────────────────────────────────
-- AFTER `supabase db push`, BEFORE deploying the new frontend.
-- Both must look right, or stop and do not ship the client.
-- ─────────────────────────────────────────────────────────────────────────

-- 6. The new rule is in force.
--    EXPECT one row: donations_category_check, with the length(btrim(category))
--    predicate. The old `category = ANY (ARRAY['society',...])` must be GONE.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'donations'::regclass and contype = 'c'
order by conname;

-- 7. Every mandal has its sources.
--    EXPECT every row to read {Society,Shop,Other}. No NULLs, no blanks.
select id, name, donation_sources from mandals order by name;

-- 8. The two new functions exist and are callable by authenticated only.
--    EXPECT: both listed, has_anon = false, has_authenticated = true.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as has_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as has_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_donation_sources', 'add_donation_source');
