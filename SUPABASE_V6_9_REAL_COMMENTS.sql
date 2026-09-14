-- OpenVideo V6.9 — Real Comments
-- This is the same database setup already run successfully in Supabase.
create table if not exists public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint video_comments_body_length check (char_length(trim(body)) between 1 and 2000)
);
create index if not exists video_comments_video_id_created_at_idx on public.video_comments(video_id, created_at desc);
alter table public.video_comments enable row level security;
drop policy if exists "Anyone can read public video comments" on public.video_comments;
create policy "Anyone can read public video comments" on public.video_comments for select using (exists (select 1 from public.videos v where v.id=video_comments.video_id and v.visibility='public' and v.status='published'));
drop policy if exists "Authenticated users can comment" on public.video_comments;
create policy "Authenticated users can comment" on public.video_comments for insert to authenticated with check (auth.uid()=user_id and exists (select 1 from public.videos v where v.id=video_comments.video_id and v.visibility='public' and v.status='published'));
drop policy if exists "Users can delete own comments" on public.video_comments;
create policy "Users can delete own comments" on public.video_comments for delete to authenticated using (auth.uid()=user_id);
select 'OpenVideo V6.9 real comments database ready!' as status;
