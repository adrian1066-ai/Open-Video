create table public.openvideo_requests (
 id uuid primary key default gen_random_uuid(), requester uuid not null references public.profiles(id), creator uuid references public.profiles(id),
 title text not null check(length(title) between 3 and 160), details text not null default '' check(length(details)<=2000),
 country text not null check(length(country) between 2 and 80),city text not null default '' check(length(city)<=100),
 status text not null default 'requested' check(status in ('requested','accepted','live','completed','expired','cancelled')),
 created_at timestamptz not null default now(),deadline timestamptz not null check(deadline>created_at),accepted_at timestamptz,
 live_id uuid unique references public.live_sessions(id),completed_at timestamptz
);
create index requests_discovery on public.openvideo_requests(status,deadline,country,city);
create index requests_requester on public.openvideo_requests(requester,created_at desc);
create index requests_creator on public.openvideo_requests(creator,created_at desc);
create table public.openvideo_area_alerts(user_id uuid primary key references public.profiles(id),country text not null check(length(country) between 2 and 80),city text not null default '' check(length(city)<=100));
alter table public.openvideo_requests enable row level security;
alter table public.openvideo_area_alerts enable row level security;
revoke all on public.openvideo_requests,public.openvideo_area_alerts from anon,authenticated;
grant all on public.openvideo_requests,public.openvideo_area_alerts to service_role;

create function public.openvideo_request_action(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.openvideo_requests;l public.live_sessions;is_mod boolean;watcher record;
begin
 if p_actor is null then raise exception 'An account is required.';end if;
 select exists(select 1 from public.openvideo_moderators where user_id=p_actor) into is_mod;
 if p_action='list' then
  update public.openvideo_requests set status='expired' where status in ('requested','accepted') and deadline<now();
  return jsonb_build_object('moderator',is_mod,'user',p_actor,
   'requests',coalesce((select jsonb_agg(to_jsonb(x)) from(select rq.* from public.openvideo_requests rq where (rq.status in ('requested','accepted','live') or rq.requester=p_actor or rq.creator=p_actor) and not public.openvideo_blocked_pair(p_actor,rq.requester) and (rq.creator is null or not public.openvideo_blocked_pair(p_actor,rq.creator)) and(coalesce(p_data->>'country','')='' or lower(rq.country)=lower(p_data->>'country')) and(coalesce(p_data->>'city','')='' or lower(rq.city)=lower(p_data->>'city')) order by rq.created_at desc limit 100)x),'[]'::jsonb),
   'alerts',(select to_jsonb(a)-'user_id' from public.openvideo_area_alerts a where a.user_id=p_actor),
   'lives',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,title,state from public.live_sessions where owner_id=p_actor and access='public' and not safety_hidden and started_at is not null order by created_at desc limit 60)x),'[]'::jsonb));
 end if;
 if not public.openvideo_consume_limit(p_actor,'request-action',30,60) then raise exception 'Please wait before trying again.';end if;
 if p_action='alerts' then
  if coalesce((p_data->>'enabled')::boolean,false) then
   insert into public.openvideo_area_alerts(user_id,country,city) values(p_actor,trim(p_data->>'country'),trim(coalesce(p_data->>'city',''))) on conflict(user_id) do update set country=excluded.country,city=excluded.city;
  else delete from public.openvideo_area_alerts where user_id=p_actor;end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='create' then
  if not public.openvideo_consume_limit(p_actor,'request-create',3,3600) then raise exception 'You can create up to three requests per hour.';end if;
  if (p_data->>'deadline')::timestamptz>now()+interval '7 days' then raise exception 'Choose a deadline within seven days.';end if;
  insert into public.openvideo_requests(requester,title,details,country,city,deadline) values(p_actor,trim(p_data->>'title'),trim(coalesce(p_data->>'details','')),trim(p_data->>'country'),trim(coalesce(p_data->>'city','')),(p_data->>'deadline')::timestamptz) returning * into r;
  for watcher in select user_id from public.openvideo_area_alerts where lower(country)=lower(r.country) and(city='' or lower(city)=lower(r.city)) loop
   perform openvideo_private.notify(watcher.user_id,p_actor,'request','New request in your chosen area',r.title,'request-new:'||r.id,'requests');
  end loop;
  return to_jsonb(r);
 end if;
 select * into r from public.openvideo_requests where id=(p_data->>'id')::uuid for update;
 if not found then raise exception 'Request not found.';end if;
 if public.openvideo_blocked_pair(p_actor,r.requester) or(r.creator is not null and public.openvideo_blocked_pair(p_actor,r.creator)) then raise exception 'Request is unavailable.';end if;
 if p_action='cancel' then
  if p_actor<>r.requester and p_actor is distinct from r.creator and not is_mod then raise exception 'Only participants or moderators may cancel.';end if;
  if r.status not in ('requested','accepted','live') then raise exception 'Request already closed.';end if;
  update public.openvideo_requests set status='cancelled' where id=r.id;
  perform openvideo_private.notify(r.requester,p_actor,'request','Request cancelled',r.title,'request-cancelled:'||r.id,'requests');
  perform openvideo_private.notify(r.creator,p_actor,'request','Request cancelled',r.title,'request-cancelled:'||r.id,'requests');return jsonb_build_object('ok',true);
 end if;
 if p_action='accept' then
  if r.requester=p_actor or r.status<>'requested' or r.deadline<now() then raise exception 'Request cannot be accepted.';end if;
  if not exists(select 1 from public.channels where owner_id=p_actor) then raise exception 'Create your channel first.';end if;
  update public.openvideo_requests set creator=p_actor,status='accepted',accepted_at=now() where id=r.id;
  perform openvideo_private.notify(r.requester,p_actor,'request','Request accepted',r.title,'request-accepted:'||r.id,'requests');return jsonb_build_object('ok',true);
 end if;
 if r.creator is distinct from p_actor then raise exception 'Only the accepting creator may do this.';end if;
 if p_action='start' then
  if r.status<>'accepted' or r.deadline<now() then raise exception 'Request is unavailable or expired.';end if;
  select * into l from public.live_sessions where id=(p_data->>'live_id')::uuid and owner_id=p_actor;
  if not found or l.state<>'live' or l.started_at is null or l.started_at<r.accepted_at or l.heartbeat_at<now()-interval '90 seconds' or l.access<>'public' or l.safety_hidden then raise exception 'Start your own new public Live first.';end if;
  if lower(l.country)<>lower(r.country) or(r.city<>'' and lower(l.city)<>lower(r.city)) then raise exception 'Share the requested country/city in your Live settings. Do not share an exact address.';end if;
  update public.openvideo_requests set status='live',live_id=l.id where id=r.id;
  perform openvideo_private.notify(r.requester,p_actor,'request','Request is live',r.title,'request-live:'||r.id,'live-'||l.id);return jsonb_build_object('ok',true);
 end if;
 if p_action='complete' then
  if r.status<>'live' or not exists(select 1 from public.live_sessions where id=r.live_id and state='ended' and not safety_hidden) then raise exception 'End the associated Live before completing your request.';end if;
  update public.openvideo_requests set status='completed',completed_at=now() where id=r.id;
  perform openvideo_private.notify(r.requester,p_actor,'request','Request completed',r.title,'request-completed:'||r.id,'requests');return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown request action.';
end $$;
revoke execute on function public.openvideo_request_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.openvideo_request_action(uuid,text,jsonb) to service_role;
