-- OpenVideo V7.3 — Real Following Feed

create or replace function public.get_following_feed_v73()
returns table (
  id uuid, channel_id uuid, title text, description text, video_url text,
  visibility text, status text, published_at timestamptz, created_at timestamptz,
  view_count bigint, like_count bigint
)
language sql security invoker stable
as $$
  select v.id,v.channel_id,v.title,v.description,v.video_url,v.visibility,v.status,
         v.published_at,v.created_at,coalesce(v.view_count,0),coalesce(v.like_count,0)
  from public.videos v
  inner join public.channel_follows cf on cf.channel_id=v.channel_id
  where cf.follower_id=auth.uid() and v.visibility='public' and v.status='published'
  order by coalesce(v.published_at,v.created_at) desc;
$$;

grant execute on function public.get_following_feed_v73() to authenticated;
select 'OpenVideo V7.3 real Following feed ready!' as status;
