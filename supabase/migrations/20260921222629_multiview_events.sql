create table public.openvideo_events(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),title text not null check(length(title) between 3 and 160),topic text not null default '' check(length(topic)<=100),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 day',closed boolean not null default false);
create table public.openvideo_event_members(live_id uuid primary key references public.live_sessions(id),event_id uuid not null references public.openvideo_events(id),joined_at timestamptz not null default now());
create index event_members_event on public.openvideo_event_members(event_id);
alter table public.openvideo_events enable row level security;
alter table public.openvideo_event_members enable row level security;
revoke all on public.openvideo_events,public.openvideo_event_members from anon,authenticated;
grant all on public.openvideo_events,public.openvideo_event_members to service_role;
create function public.openvideo_event_action(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ev public.openvideo_events;ls public.live_sessions;
begin
 if p_actor is null then raise exception 'An account is required.';end if;
 if p_action='list' then
  return jsonb_build_object('user',p_actor,'events',coalesce((select jsonb_agg(to_jsonb(x)) from(select et.id,et.owner_id,et.title,et.topic,et.expires_at,
   coalesce((select jsonb_agg(em.live_id) from public.openvideo_event_members em join public.live_sessions s on s.id=em.live_id where em.event_id=et.id and s.state='live' and s.heartbeat_at>now()-interval '90 seconds' and not s.safety_hidden and not public.openvideo_blocked_pair(p_actor,s.owner_id)),'[]'::jsonb) as live_ids
   from public.openvideo_events et where not et.closed and et.expires_at>now() and not public.openvideo_blocked_pair(p_actor,et.owner_id) order by et.created_at desc limit 100)x),'[]'::jsonb),
   'lives',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title)) from public.live_sessions where owner_id=p_actor and state='live' and not safety_hidden and heartbeat_at>now()-interval '90 seconds'),'[]'::jsonb));
 end if;
 if not public.openvideo_consume_limit(p_actor,'event',20,60) then raise exception 'Please wait before trying again.';end if;
 if p_action='create' then
  if not exists(select 1 from public.channels where owner_id=p_actor) then raise exception 'Create your channel first.';end if;
  if not public.openvideo_consume_limit(p_actor,'event-create',3,3600) then raise exception 'You can create up to three events per hour.';end if;
  insert into public.openvideo_events(owner_id,title,topic) values(p_actor,trim(p_data->>'title'),trim(coalesce(p_data->>'topic',''))) returning * into ev;return to_jsonb(ev);
 end if;
 select * into ev from public.openvideo_events where id=(p_data->>'id')::uuid for update;
 if not found or ev.closed or ev.expires_at<now() or public.openvideo_blocked_pair(p_actor,ev.owner_id) then raise exception 'Event is unavailable.';end if;
 if p_action='close' then
  if ev.owner_id<>p_actor and not exists(select 1 from public.openvideo_moderators where user_id=p_actor) then raise exception 'Only the organizer or a moderator may close an event.';end if;
  update public.openvideo_events set closed=true where id=ev.id;return jsonb_build_object('ok',true);
 end if;
 select * into ls from public.live_sessions where id=(p_data->>'live_id')::uuid and owner_id=p_actor;
 if not found then raise exception 'Only the Live owner may choose its event.';end if;
 if p_action='leave' then delete from public.openvideo_event_members where live_id=ls.id and event_id=ev.id;return jsonb_build_object('ok',true);end if;
 if p_action='join' then
  if ls.state<>'live' or ls.heartbeat_at<now()-interval '90 seconds' or ls.safety_hidden then raise exception 'Start your Live first.';end if;
  insert into public.openvideo_event_members(live_id,event_id) values(ls.id,ev.id) on conflict(live_id) do update set event_id=excluded.event_id,joined_at=now();return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown event action.';
end $$;
revoke execute on function public.openvideo_event_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.openvideo_event_action(uuid,text,jsonb) to service_role;
