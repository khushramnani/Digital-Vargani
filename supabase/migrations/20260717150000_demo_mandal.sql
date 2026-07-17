-- A published demo mandal, so the landing page's "See a sample report →"
-- CTA can show a real transparency report instead of dead-ending.
--
-- Why a migration and not seed.sql: seed.sql only runs against the local
-- verify cluster. This has to exist on the live project, and `supabase db
-- push` applies migrations.
--
-- Safety of the demo team rows below: both have auth_user_id NULL, email
-- NULL, and invite_token NULL, so there is no way to authenticate as this
-- mandal — no magic link (link_admin_account matches on a non-null email),
-- no invite redemption (redeem_invite matches on a non-null token). The
-- mandal exists to be read in aggregate by the public transparency RPCs and
-- nothing else. The donor names are invented; they are never exposed
-- publicly in any case, since the transparency surface is totals plus a
-- spend-by-category breakdown, with no donor rows.
--
-- mandal_id is supplied explicitly on every insert here: a migration runs as
-- the table owner with no session, so app_mandal_id() is null and
-- enforce_insert_defaults() falls back to the supplied value (see
-- 20260717130000). receipt_no is still allocated by the trigger from
-- mandals.next_receipt_no, so the demo's receipts number 1..n like any real
-- mandal's.

insert into mandals (id, name, slug, receipt_prefix, expense_categories,
                     bank_opening_paise, transparency_published)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'Digital Vargani Demo Mandal',
  'demo',
  'DV',
  '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}',
  0,
  true
)
on conflict (id) do nothing;

insert into users (id, mandal_id, name, role, active) values
  ('dddddddd-0000-0000-0000-000000000001',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Demo Treasurer', 'admin', true),
  ('dddddddd-0000-0000-0000-000000000002',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Demo Volunteer', 'volunteer', true)
on conflict (id) do nothing;

-- Collections: a plausible spread of door-to-door vargani.
insert into donations (mandal_id, donor_name, amount_paise, mode, collected_by)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd', donor, paise, mode,
       'dddddddd-0000-0000-0000-000000000002'
from (values
  ('Suresh Patil',      1100000, 'cash'),
  ('Anjali Deshmukh',    500000, 'upi'),
  ('Ramesh Kulkarni',    250000, 'cash'),
  ('Priya Joshi',        750000, 'upi'),
  ('Mahesh Shinde',      300000, 'cash'),
  ('Kavita Rao',        1500000, 'bank'),
  ('Nitin Gaikwad',      200000, 'cash'),
  ('Sunita More',        450000, 'upi'),
  ('Vijay Chavan',       600000, 'cash'),
  ('Meera Kadam',        350000, 'upi')
) as d(donor, paise, mode)
where not exists (
  select 1 from donations
  where mandal_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
);

-- Spend: enough categories that the pie chart has something to say.
insert into expenses (mandal_id, category, amount_paise, description, paid_by, paid_from)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd', cat, paise, descr,
       'dddddddd-0000-0000-0000-000000000001', src
from (values
  ('Mandap',     1800000, 'Pandal structure and setup',   'bank'),
  ('Murti',      1200000, 'Idol and installation',        'cash'),
  ('Decoration',  650000, 'Lighting and flowers',         'cash'),
  ('Prasad',      400000, 'Daily prasad distribution',    'cash'),
  ('Sound',       300000, 'Speakers and mics',            'bank'),
  ('Events',      250000, 'Aarti and cultural programme', 'cash')
) as e(cat, paise, descr, src)
where not exists (
  select 1 from expenses
  where mandal_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
);
