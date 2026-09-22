create table public.openvideo_missions(id uuid primary key default gen_random_uuid(),created_by uuid not null references public.profiles(id),title text not null check(length(title) between 3 and 160),requirements text not null check(length(requirements) between 3 and 2000),proof_kind text not null check(proof_kind in ('any','live','video')),required_count integer not null check(required_count between 2 and 100),xp integer not null check(xp between 0 and 10000),deadline timestamptz not null,created_at timestamptz not null default now(),check(deadline>created_at));
create table public.openvideo_mission_entries(id uuid primary key default gen_random_uuid(),mission_id uuid not null references public.openvideo_missions(id),user_id uuid not null references public.profiles(id),accepted_at timestamptz not null default now(),status text not null default 'accepted' check(status in ('accepted','completed','expired')),completed_at timestamptz,unique(mission_id,user_id));
create table public.openvideo_mission_evidence(challenge_entry uuid primary key references public.openvideo_challenge_entries(id),mission_entry uuid not null references public.openvideo_mission_entries(id));
create index mission_entry_user on public.openvideo_mission_entries(user_id,accepted_at desc);
create index mission_evidence_entry on public.openvideo_mission_evidence(mission_entry);
alter table public.openvideo_missions enable row level security;
alter table public.openvideo_mission_entries enable row level security;
alter table public.openvideo_mission_evidence enable row level security;
revoke all on public.openvideo_missions,public.openvideo_mission_entries,public.openvideo_mission_evidence from anon,authenticated;
grant all on public.openvideo_missions,public.openvideo_mission_entries,public.openvideo_mission_evidence to service_role;

create function public.openvideo_mission_action(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.openvideo_missions;e public.openvideo_mission_entries;is_mod boolean;proofs uuid[];
begin
 if p_actor is null then raise exception 'An account is required.';end if;
 select exists(select 1 from public.openvideo_moderators where user_id=p_actor) into is_mod;
 if p_action='list' then
  update public.openvideo_mission_entries ent set status='expired' from public.openvideo_missions mi where ent.mission_id=mi.id and ent.user_id=p_actor and ent.status='accepted' and mi.deadline<now();
  return jsonb_build_object('moderator',is_mod,
   'missions',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from public.openvideo_missions where deadline>now() order by created_at desc limit 100)x),'[]'::jsonb),
   'entries',coalesce((select jsonb_agg(to_jsonb(x)) from(select ent.*,mi.title,mi.proof_kind,mi.required_count,mi.xp,mi.deadline,
    (select count(*) from public.openvideo_challenge_entries ce join public.openvideo_challenges ch on ch.id=ce.challenge_id where ce.user_id=p_actor and ce.status='completed' and ce.accepted_at>=ent.accepted_at and ce.completed_at<=mi.deadline and(mi.proof_kind='any' or ch.proof_kind=mi.proof_kind) and not exists(select 1 from public.openvideo_mission_evidence ev where ev.challenge_entry=ce.id and ev.mission_entry<>ent.id)) as progress,
    coalesce((select jsonb_agg(jsonb_build_object('live_id',ce.proof_live,'video_id',ce.proof_video)) from public.openvideo_mission_evidence ev join public.openvideo_challenge_entries ce on ce.id=ev.challenge_entry where ev.mission_entry=ent.id),'[]'::jsonb) as evidence
    from public.openvideo_mission_entries ent join public.openvideo_missions mi on mi.id=ent.mission_id where ent.user_id=p_actor order by ent.accepted_at desc limit 100)x),'[]'::jsonb));
 end if;
 if not public.openvideo_consume_limit(p_actor,'mission',30,60) then raise exception 'Please wait before trying again.';end if;
 if p_action='create' then
  if not is_mod then raise exception 'Moderator access required.';end if;
  insert into public.openvideo_missions(created_by,title,requirements,proof_kind,required_count,xp,deadline) values(p_actor,trim(p_data->>'title'),trim(p_data->>'requirements'),p_data->>'proof_kind',(p_data->>'required_count')::integer,(p_data->>'xp')::integer,(p_data->>'deadline')::timestamptz) returning * into m;return to_jsonb(m);
 end if;
 if p_action='accept' then
  select * into m from public.openvideo_missions where id=(p_data->>'id')::uuid;
  if not found or m.deadline<=now() then raise exception 'Mission is unavailable.';end if;
  insert into public.openvideo_mission_entries(mission_id,user_id) values(m.id,p_actor) on conflict(mission_id,user_id) do nothing;return jsonb_build_object('ok',true);
 end if;
 if p_action='complete' then
  perform 1 from public.profiles where id=p_actor for update;
  select * into e from public.openvideo_mission_entries where id=(p_data->>'id')::uuid and user_id=p_actor for update;
  if not found then raise exception 'Mission entry not found.';end if;
  if e.status='completed' then return jsonb_build_object('ok',true);end if;
  select * into m from public.openvideo_missions where id=e.mission_id;
  if e.status<>'accepted' or m.deadline<now() then raise exception 'Mission has expired.';end if;
  select array_agg(x.id) into proofs from(select ce.id from public.openvideo_challenge_entries ce join public.openvideo_challenges ch on ch.id=ce.challenge_id
   where ce.user_id=p_actor and ce.status='completed' and ce.accepted_at>=e.accepted_at and ce.completed_at<=m.deadline and(m.proof_kind='any' or ch.proof_kind=m.proof_kind)
   and not exists(select 1 from public.openvideo_mission_evidence ev where ev.challenge_entry=ce.id)
   and(ce.proof_live is null or exists(select 1 from public.live_sessions where id=ce.proof_live and not safety_hidden))
   and(ce.proof_video is null or exists(select 1 from public.videos where id=ce.proof_video and not safety_hidden))
   order by ce.completed_at,ce.id limit m.required_count)x;
  if coalesce(array_length(proofs,1),0)<m.required_count then raise exception 'Complete enough new approved challenges first.';end if;
  insert into public.openvideo_mission_evidence(challenge_entry,mission_entry) select unnest(proofs),e.id;
  update public.openvideo_mission_entries set status='completed',completed_at=now() where id=e.id;
  perform openvideo_private.award_xp(p_actor,'mission',e.id,m.xp);
  perform openvideo_private.notify(p_actor,null,'mission','Mission completed',m.title,'mission:'||e.id,'missions');return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown mission action.';
end $$;
revoke execute on function public.openvideo_mission_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.openvideo_mission_action(uuid,text,jsonb) to service_role;
