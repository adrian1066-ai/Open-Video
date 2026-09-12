-- OpenVideo V6.7 — Real Likes
-- One signed-in account can have at most one like per video.
-- Clicking Like again removes it.

alter table public.videos
add column if not exists like_count bigint not null default 0;

create table if not exists public.video_likes (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

alter table public.video_likes enable row level security;

-- Browsers do not need direct table access.
-- All like operations go through SECURITY DEFINER RPC functions.

create or replace function public.get_video_like_state_v67(
  p_video_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_count bigint;
  is_liked boolean;
begin
  current_user_id := auth.uid();

  select coalesce(v.like_count,0)
    into current_count
  from public.videos v
  where v.id = p_video_id;

  is_liked := case
    when current_user_id is null then false
    else exists (
      select 1
      from public.video_likes l
      where l.video_id = p_video_id
        and l.user_id = current_user_id
    )
  end;

  return jsonb_build_object(
    'liked', coalesce(is_liked,false),
    'count', coalesce(current_count,0)
  );
end;
$$;

create or replace function public.toggle_video_like_v67(
  p_video_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  now_liked boolean;
  new_count bigint;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Sign in required to like a video';
  end if;

  if not exists (
    select 1
    from public.videos v
    where v.id = p_video_id
      and v.visibility = 'public'
      and v.status = 'published'
  ) then
    raise exception 'Only public published videos can be liked';
  end if;

  if exists (
    select 1
    from public.video_likes l
    where l.video_id = p_video_id
      and l.user_id = current_user_id
  ) then
    delete from public.video_likes
    where video_id = p_video_id
      and user_id = current_user_id;
    now_liked := false;
  else
    insert into public.video_likes(video_id,user_id)
    values (p_video_id,current_user_id)
    on conflict (video_id,user_id) do nothing;
    now_liked := true;
  end if;

  select count(*)
    into new_count
  from public.video_likes
  where video_id = p_video_id;

  update public.videos
  set like_count = new_count
  where id = p_video_id;

  return jsonb_build_object(
    'liked', now_liked,
    'count', coalesce(new_count,0)
  );
end;
$$;

grant execute on function public.get_video_like_state_v67(uuid)
to anon, authenticated;

grant execute on function public.toggle_video_like_v67(uuid)
to authenticated;

select 'OpenVideo V6.7 real likes ready!' as status;
