-- Task 6: Supabase Storage bucket for mandal branding assets (logo,
-- president signature, UPI QR). Public read is correct here: these images
-- are exactly what the public receipt/transparency pages need to display,
-- and none of them are donor data. No delete policy — same "no hard
-- delete" pattern as the other tables; re-uploading overwrites via
-- upsert:true on the same path, or writes a new timestamped path and the
-- app updates the *_url column to point at it instead.

insert into storage.buckets (id, name, public)
values ('mandal-assets', 'mandal-assets', true)
on conflict (id) do nothing;

create policy mandal_assets_admin_write on storage.objects
  for insert with check (bucket_id = 'mandal-assets' and is_admin());
create policy mandal_assets_admin_update on storage.objects
  for update using (bucket_id = 'mandal-assets' and is_admin())
  with check (bucket_id = 'mandal-assets' and is_admin());
create policy mandal_assets_public_read on storage.objects
  for select using (bucket_id = 'mandal-assets');
