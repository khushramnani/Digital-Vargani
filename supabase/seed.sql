-- Two mandals, so that every RLS assertion in verify-local.sh has a
-- negative control. A single-mandal seed cannot prove isolation: with one
-- tenant, a policy that forgot its mandal predicate passes every test.

insert into mandals (id, name, slug, receipt_prefix, expense_categories, bank_opening_paise) values
  ('11111111-1111-1111-1111-000000000001', 'Vinayak Mitra Mandal', 'mandal-one', 'VM',
   '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}', 500000),
  ('22222222-2222-2222-2222-000000000002', 'Ganesh Seva Mandal', 'mandal-two', 'GS',
   '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}', 100000)
on conflict (id) do nothing;

-- Mandal One: one admin, two volunteers (ids match the pre-multi-tenancy
-- seed so the existing assertions keep working).
insert into users (id, mandal_id, name, phone, role, active) values
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-000000000001',
   'Admin Treasurer', '9000000001', 'admin', true)
on conflict (id) do nothing;

insert into users (id, mandal_id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-000000000001',
   'Volunteer One', '9000000002', 'volunteer', 'seed-invite-token-vol1', true),
  ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-000000000001',
   'Volunteer Two', '9000000003', 'volunteer', 'seed-invite-token-vol2', true)
on conflict (id) do nothing;

update users set email = 'admin@example.com' where id = '00000000-0000-0000-0000-000000000001';

-- Mandal Two: the negative control. Its admin is the session every
-- isolation assertion tries (and must fail) to read Mandal One's data from.
insert into users (id, mandal_id, name, phone, role, active) values
  ('00000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-000000000002',
   'Other Admin', '9000000011', 'admin', true)
on conflict (id) do nothing;

insert into users (id, mandal_id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-000000000002',
   'Other Volunteer', '9000000012', 'volunteer', 'seed-invite-token-other', true)
on conflict (id) do nothing;

update users set email = 'other-admin@example.com' where id = '00000000-0000-0000-0000-0000000000b1';

-- auth.users row so the verify script's mandal-two admin session resolves.
-- Mandal one's auth.users rows are inserted by verify-local.sh's own
-- backfill block, so they are deliberately not seeded here.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000b1', 'other-admin@example.com')
on conflict (id) do nothing;

update users set auth_user_id = 'aaaaaaaa-0000-0000-0000-0000000000b1'
where id = '00000000-0000-0000-0000-0000000000b1';
