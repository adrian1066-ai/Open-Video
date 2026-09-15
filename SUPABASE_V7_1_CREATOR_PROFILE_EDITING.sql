-- OpenVideo V7.1 — Creator Profile Editing + Creator Media

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-media',
  'creator-media',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Anyone can view creator media" on storage.objects;
create policy "Anyone can view creator media"
on storage.objects for select
using (bucket_id = 'creator-media');

drop policy if exists "Users can upload own creator media" on storage.objects;
create policy "Users can upload own creator media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'creator-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own creator media" on storage.objects;
create policy "Users can update own creator media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'creator-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'creator-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own creator media" on storage.objects;
create policy "Users can delete own creator media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'creator-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

select 'OpenVideo V7.1 creator profile editing ready!' as status;
