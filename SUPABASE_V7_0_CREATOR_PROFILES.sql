-- OpenVideo V7.0 — Real Creator Profiles / Channels

alter table public.channels add column if not exists avatar_url text;
alter table public.channels add column if not exists banner_url text;
alter table public.channels add column if not exists created_at timestamptz default now();

alter table public.channels enable row level security;

drop policy if exists "Anyone can view public channels" on public.channels;
create policy "Anyone can view public channels" on public.channels for select using (true);

drop policy if exists "Owners can update their channels" on public.channels;
create policy "Owners can update their channels" on public.channels for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists channels_owner_id_idx on public.channels(owner_id);
create index if not exists channels_handle_idx on public.channels(handle);
create index if not exists videos_channel_id_idx on public.videos(channel_id);

select 'OpenVideo V7.0 creator profiles database ready!' as status;
