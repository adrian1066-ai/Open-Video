-- Challenges use existing Lives/videos as evidence. Only the authenticated service broker writes.
create table public.openvideo_challenges (
 id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id),
 title text not null check(length(title) between 3 and 160), requirements text not null check(length(requirements) between 3 and 2000),
 proof_kind text not null check(proof_kind in ('live','video')), scope text not null check(scope in ('global','location','xp','sponsored')),
 country text not null default '' check(length(country)<=80), city text not null default '' check(length(city)<=100),
 target_user uuid references public.profiles(id), starts_at timestamptz not null default now(), closes_at timestamptz not null,
 duration_seconds integer not null check(duration_seconds between 60 and 2592000), xp integer not null default 100 check(xp between 0 and 10000),
 active boolean not null default true, created_at timestamptz not null default now(), check(closes_at>starts_at)
);
create table public.openvideo_challenge_entries (
 id uuid primary key default gen_random_uuid(), challenge_id uuid not null references public.openvideo_challenges(id),
 user_id uuid not null references public.profiles(id), status text not null default 'accepted' check(status in ('accepted','submitted','completed','expired','rejected')),
 accepted_at timestamptz not null default now(), deadline timestamptz not null, submitted_at timestamptz, completed_at timestamptz,
 proof_live uuid references public.live_sessions(id), proof_video uuid references public.videos(id),
 reviewer uuid references public.profiles(id), review_note text not null default '' check(length(review_note)<=2000),
 unique(challenge_id,user_id), check(not(proof_live is not null and proof_video is not null))
);
create unique index challenge_unique_live_proof on public.openvideo_challenge_entries(proof_live) where proof_live is not null;
create unique index challenge_unique_video_proof on public.openvideo_challenge_entries(proof_video) where proof_video is not null;
create index challenge_user_history on public.openvideo_challenge_entries(user_id,accepted_at desc);
create index challenge_pending on public.openvideo_challenge_entries(status,deadline);
alter table public.openvideo_challenges enable row level security;
alter table public.openvideo_challenge_entries enable row level security;
revoke all on public.openvideo_challenges,public.openvideo_challenge_entries from anon,authenticated;
grant all on public.openvideo_challenges,public.openvideo_challenge_entries to service_role;

create function public.openvideo_challenge_action(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.openvideo_challenges; e public.openvideo_challenge_entries; l public.live_sessions; v public.videos;
 is_mod boolean; result jsonb; identity_id uuid;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor) then raise exception 'An account is required.';end if;
 select exists(select 1 from public.openvideo_moderators where user_id=p_actor) into is_mod;
 if p_action='list' then
  update public.openvideo_challenge_entries set status='expired' where user_id=p_actor and status='accepted' and deadline<now();
  select jsonb_build_object('moderator',is_mod,
   'challenges',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,requirements,proof_kind,scope,country,city,starts_at,closes_at,duration_seconds,xp from public.openvideo_challenges where active and (target_user is null or target_user=p_actor or is_mod) and (closes_at>now() or is_mod) order by created_at desc limit 100)x),'[]'::jsonb),
   'entries',coalesce((select jsonb_agg(to_jsonb(x)) from (select ent.*,chg.title,chg.proof_kind from public.openvideo_challenge_entries ent join public.openvideo_challenges chg on chg.id=ent.challenge_id where ent.user_id=p_actor order by ent.accepted_at desc limit 100)x),'[]'::jsonb),
   'review',case when is_mod then coalesce((select jsonb_agg(to_jsonb(x)) from (select ent.*,chg.title,chg.requirements,chg.proof_kind from public.openvideo_challenge_entries ent join public.openvideo_challenges chg on chg.id=ent.challenge_id where ent.status='submitted' order by ent.submitted_at limit 100)x),'[]'::jsonb) else '[]'::jsonb end,
   'lives',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,started_at,state from public.live_sessions where owner_id=p_actor and started_at is not null and not safety_hidden order by created_at desc limit 60)x),'[]'::jsonb),
   'videos',coalesce((select jsonb_agg(to_jsonb(x)) from (select vid.id,vid.title from public.videos vid join public.channels ch on ch.id=vid.channel_id where ch.owner_id=p_actor and not vid.safety_hidden and vid.status='published' and vid.visibility='public' order by vid.created_at desc limit 60)x),'[]'::jsonb)) into result;
  return result;
 end if;
 if not public.openvideo_consume_limit(p_actor,'challenge',30,60) then raise exception 'Please wait before trying again.';end if;
 if p_action='create' then
  if not is_mod then raise exception 'Moderator access required.';end if;
  if p_data->>'scope'='sponsored' then raise exception 'Sponsored challenges are reserved for a later release.';end if;
  insert into public.openvideo_challenges(created_by,title,requirements,proof_kind,scope,country,city,target_user,closes_at,duration_seconds,xp)
  values(p_actor,trim(p_data->>'title'),trim(p_data->>'requirements'),p_data->>'proof_kind',p_data->>'scope',trim(coalesce(p_data->>'country','')),trim(coalesce(p_data->>'city','')),nullif(p_data->>'target_user','')::uuid,(p_data->>'closes_at')::timestamptz,(p_data->>'duration_seconds')::integer,coalesce((p_data->>'xp')::integer,100)) returning * into c;
  if c.scope='location' and c.country='' then raise exception 'Choose a country for a location challenge.';end if;
  if c.target_user is not null then perform openvideo_private.notify(c.target_user,p_actor,'challenge','New challenge',c.title,'challenge:'||c.id,'challenges');end if;
  return to_jsonb(c);
 end if;
 if p_action='accept' then
  select * into c from public.openvideo_challenges where id=(p_data->>'id')::uuid for share;
  if not found or not c.active or c.starts_at>now() or c.closes_at<=now() or(c.target_user is not null and c.target_user<>p_actor) then raise exception 'Challenge is unavailable.';end if;
  if not exists(select 1 from public.channels where owner_id=p_actor) then raise exception 'Create your channel first.';end if;
  insert into public.openvideo_challenge_entries(challenge_id,user_id,deadline) values(c.id,p_actor,least(c.closes_at,now()+make_interval(secs=>c.duration_seconds))) on conflict(challenge_id,user_id) do nothing;
  select * into e from public.openvideo_challenge_entries where challenge_id=c.id and user_id=p_actor;
  return to_jsonb(e);
 end if;
 select * into e from public.openvideo_challenge_entries where id=(p_data->>'id')::uuid for update;
 if not found then raise exception 'Challenge entry not found.';end if;
 select * into c from public.openvideo_challenges where id=e.challenge_id;
 if p_action='submit' then
  if e.user_id<>p_actor or e.status<>'accepted' then raise exception 'This entry cannot be submitted.';end if;
  if e.deadline<now() or not c.active then raise exception 'Challenge deadline has passed.';end if;
  identity_id=(p_data->>'proof_id')::uuid;
  if c.proof_kind='live' then
   select * into l from public.live_sessions where id=identity_id and owner_id=p_actor;
   if not found or l.started_at is null or l.started_at<e.accepted_at or l.started_at>e.deadline or l.safety_hidden or l.access<>'public' or l.state not in ('live','ended') then raise exception 'Use a public OpenVideo Live started after accepting this challenge.';end if;
   if c.scope='location' and(lower(l.country)<>lower(c.country) or(c.city<>'' and lower(l.city)<>lower(c.city))) then raise exception 'The Live must share the challenge country/city. Location is creator declared.';end if;
   update public.openvideo_challenge_entries set proof_live=l.id,status='submitted',submitted_at=now() where id=e.id;
  else
   select vid.* into v from public.videos vid join public.channels ch on ch.id=vid.channel_id where vid.id=identity_id and ch.owner_id=p_actor;
   if not found or v.created_at<e.accepted_at or v.status<>'published' or v.visibility<>'public' or v.safety_hidden then raise exception 'Use your own new public video.';end if;
   update public.openvideo_challenge_entries set proof_video=v.id,status='submitted',submitted_at=now() where id=e.id;
  end if;
  return jsonb_build_object('ok',true,'status','submitted');
 end if;
 if p_action='review' then
  if not is_mod or e.user_id=p_actor then raise exception 'An independent moderator is required.';end if;
  if e.status<>'submitted' or p_data->>'decision' not in ('completed','rejected') then raise exception 'Invalid review.';end if;
  if p_data->>'decision'='completed' and ((e.proof_live is not null and exists(select 1 from public.live_sessions where id=e.proof_live and safety_hidden)) or(e.proof_video is not null and exists(select 1 from public.videos where id=e.proof_video and safety_hidden))) then raise exception 'Hidden content cannot complete a challenge.';end if;
  update public.openvideo_challenge_entries set status=p_data->>'decision',reviewer=p_actor,review_note=coalesce(p_data->>'note',''),completed_at=case when p_data->>'decision'='completed' then now() end where id=e.id;
  perform openvideo_private.notify(e.user_id,p_actor,'challenge','Challenge reviewed',c.title||': '||(p_data->>'decision'),'challenge-review:'||e.id,'challenges');
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown challenge action.';
end $$;
revoke execute on function public.openvideo_challenge_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.openvideo_challenge_action(uuid,text,jsonb) to service_role;
