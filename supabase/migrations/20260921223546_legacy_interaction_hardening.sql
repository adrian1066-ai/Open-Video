-- Retire the unused unlimited view counter; current clients use record_video_view_v66.
revoke execute on function public.increment_video_view(uuid) from public,anon,authenticated;
revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.sync_channel_follower_count() from public,anon,authenticated;

-- Read helpers now observe row security and never write counters on page load.
create or replace function public.get_video_like_state_v67(p_video_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('liked',exists(select 1 from public.video_likes where video_id=p_video_id and user_id=(select auth.uid())),
 'count',coalesce((select like_count from public.videos where id=p_video_id),0));
$$;
create or replace function public.get_channel_follow_state_v68(p_channel_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('followed',exists(select 1 from public.channel_follows where channel_id=p_channel_id and follower_id=(select auth.uid())),
 'count',coalesce((select subscriber_count from public.channels where id=p_channel_id),0),
 'is_owner',exists(select 1 from public.channels where id=p_channel_id and owner_id=(select auth.uid())));
$$;

create or replace function public.record_video_view_v66(p_video_id uuid,p_viewer_key text) returns bigint
language plpgsql security definer set search_path='' as $$
declare vid public.videos;owner_user uuid;viewer_user uuid:=auth.uid();effective_key text;
begin
 -- Row locking makes concurrent repeated views atomic for this video.
 select * into vid from public.videos where id=p_video_id for update;
 if not found then return 0;end if;
 select owner_id into owner_user from public.channels where id=vid.channel_id;
 if owner_user=viewer_user then return coalesce(vid.view_count,0);end if;
 if vid.visibility<>'public' or vid.status<>'published' or vid.safety_hidden or
  public.openvideo_blocked_pair(viewer_user,owner_user) or(vid.age_restricted and not openvideo_private.adult_viewer()) then return 0;end if;
 if viewer_user is null and(length(coalesce(p_viewer_key,''))<8 or length(p_viewer_key)>128) then return coalesce(vid.view_count,0);end if;
 effective_key=case when viewer_user is not null then 'user:'||viewer_user else 'browser:'||p_viewer_key end;
 if exists(select 1 from public.video_view_events where video_id=p_video_id and viewer_key=effective_key and viewed_at>=now()-interval '24 hours') then return coalesce(vid.view_count,0);end if;
 insert into public.video_view_events(video_id,viewer_key,viewer_user_id) values(p_video_id,effective_key,viewer_user);
 update public.videos set view_count=coalesce(view_count,0)+1 where id=p_video_id returning view_count into vid.view_count;
 return vid.view_count;
end $$;
-- Keep the two existing write RPCs; they validate auth.uid and their insert triggers enforce blocking/rate limits.
revoke execute on function public.toggle_video_like_v67(uuid),public.toggle_channel_follow_v68(uuid) from public,anon;
grant execute on function public.toggle_video_like_v67(uuid),public.toggle_channel_follow_v68(uuid) to authenticated;
