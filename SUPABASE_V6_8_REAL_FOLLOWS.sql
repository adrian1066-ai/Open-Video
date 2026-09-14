-- OpenVideo V6.8 — Real Follows (compatible with existing follower_id schema)

-- Keep existing channel_follows table structure:
-- id, follower_id, channel_id, created_at

alter table public.channels
add column if not exists subscriber_count bigint not null default 0;

alter table public.channel_follows enable row level security;

drop policy if exists "Anyone can read follows" on public.channel_follows;
create policy "Anyone can read follows"
on public.channel_follows
for select
using (true);

drop policy if exists "Authenticated users can follow" on public.channel_follows;
create policy "Authenticated users can follow"
on public.channel_follows
for insert
to authenticated
with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow" on public.channel_follows;
create policy "Users can unfollow"
on public.channel_follows
for delete
to authenticated
using (auth.uid() = follower_id);

create or replace function public.get_channel_follow_state_v68(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  c bigint;
  f boolean;
  owner boolean;
begin
  select count(*) into c
  from public.channel_follows
  where channel_id = p_channel_id;

  select exists(
    select 1 from public.channel_follows
    where channel_id = p_channel_id and follower_id = u
  ) into f;

  select exists(
    select 1 from public.channels
    where id = p_channel_id and owner_id = u
  ) into owner;

  update public.channels
  set subscriber_count = c
  where id = p_channel_id;

  return jsonb_build_object(
    'followed', coalesce(f,false),
    'count', coalesce(c,0),
    'is_owner', coalesce(owner,false)
  );
end;
$$;

create or replace function public.toggle_channel_follow_v68(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  now_followed boolean;
  c bigint;
begin
  if u is null then
    raise exception 'Sign in required to follow a creator';
  end if;

  if exists(
    select 1 from public.channels
    where id = p_channel_id and owner_id = u
  ) then
    raise exception 'You cannot follow your own channel';
  end if;

  if exists(
    select 1 from public.channel_follows
    where channel_id = p_channel_id and follower_id = u
  ) then
    delete from public.channel_follows
    where channel_id = p_channel_id and follower_id = u;
    now_followed := false;
  else
    insert into public.channel_follows(follower_id, channel_id)
    values (u, p_channel_id);
    now_followed := true;
  end if;

  select count(*) into c
  from public.channel_follows
  where channel_id = p_channel_id;

  update public.channels
  set subscriber_count = c
  where id = p_channel_id;

  return jsonb_build_object(
    'followed', now_followed,
    'count', coalesce(c,0)
  );
end;
$$;

grant execute on function public.get_channel_follow_state_v68(uuid)
to anon, authenticated;

grant execute on function public.toggle_channel_follow_v68(uuid)
to authenticated;

update public.channels c
set subscriber_count = (
  select count(*)
  from public.channel_follows cf
  where cf.channel_id = c.id
);

select 'OpenVideo V6.8 real follows ready!' as status;
