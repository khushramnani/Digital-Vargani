insert into mandal_config (id, name, receipt_prefix, expense_categories, bank_opening_paise)
values (true, 'Vinayak Mitra Mandal', 'VM', '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}', 500000)
on conflict (id) do nothing;

insert into users (id, name, phone, role, active) values
  ('00000000-0000-0000-0000-000000000001', 'Admin Treasurer', '9000000001', 'admin', true)
on conflict (id) do nothing;

insert into users (id, name, phone, role, invite_token, active) values
  ('00000000-0000-0000-0000-000000000002', 'Volunteer One', '9000000002', 'volunteer', 'seed-invite-token-vol1', true),
  ('00000000-0000-0000-0000-000000000003', 'Volunteer Two', '9000000003', 'volunteer', 'seed-invite-token-vol2', true)
on conflict (id) do nothing;

update users set email = 'admin@example.com' where id = '00000000-0000-0000-0000-000000000001';
