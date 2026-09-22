-- Extends the existing notification inbox. Clients only read their inbox and mark items read.
alter table public.notifications add column event_key text,add column route text;
create unique index notifications_deduplicate on public.notifications(user_id,event_key) where event_key is not null;
create index notifications_inbox on public.notifications(user_id,created_at desc);
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
grant update(read) on public.notifications to authenticated;
grant all on public.notifications to service_role;

create function openvideo_private.notify(p_user uuid,p_actor uuid,p_type text,p_title text,p_message text,p_event text,p_route text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or p_user=p_actor or public.openvideo_blocked_pair(p_user,p_actor) then return;end if;
 insert into public.notifications(user_id,actor_id,type,title,message,event_key,route)
 values(p_user,p_actor,p_type,left(p_title,160),left(p_message,1000),p_event,p_route)
 on conflict(user_id,event_key) where event_key is not null do nothing;
end $$;
revoke execute on function openvideo_private.notify(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;

create function openvideo_private.notify_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_user uuid;f record;channel_name text;
begin
 if tg_table_name='channel_follows' then
  select owner_id into owner_user from public.channels where id=new.channel_id;
  perform openvideo_private.notify(owner_user,new.follower_id,'follow','New follower','Someone followed your channel.','follow:'||new.channel_id||':'||new.follower_id,'channel-'||new.channel_id);
 elsif tg_table_name='video_comments' then
  select c.owner_id into owner_user from public.videos v join public.channels c on c.id=v.channel_id where v.id=new.video_id;
  perform openvideo_private.notify(owner_user,new.user_id,'comment','New comment',new.body,'comment:'||new.id,'real-'||new.video_id);
 elsif tg_table_name='live_sessions' and new.state='live' and old.state='starting' and not new.safety_hidden then
  select name into channel_name from public.channels where id=new.channel_id;
  for f in select follower_id from public.channel_follows where channel_id=new.channel_id loop
   if new.access='public' or exists(select 1 from public.live_subscriptions where channel_id=new.channel_id and user_id=f.follower_id and expires_at>now()) then
    perform openvideo_private.notify(f.follower_id,new.owner_id,'live',channel_name||' is live',new.title,'live:'||new.id,'live-'||new.id);
   end if;
  end loop;
 end if;
 return new;
end $$;
revoke execute on function openvideo_private.notify_activity() from public,anon,authenticated;
create trigger openvideo_notify_follow after insert on public.channel_follows for each row execute function openvideo_private.notify_activity();
create trigger openvideo_notify_comment after insert on public.video_comments for each row execute function openvideo_private.notify_activity();
create trigger openvideo_notify_live after update of state on public.live_sessions for each row execute function openvideo_private.notify_activity();
