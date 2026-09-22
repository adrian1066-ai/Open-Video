-- Reuse the existing reports table; new target fields cover the application's actual comments and Lives.
alter table public.reports add column target_kind text check(target_kind in ('video','live','comment','live-comment','user')),
 add column target_id text;
create index reports_queue on public.reports(status,created_at desc);
create index reports_target on public.reports(target_kind,target_id);
revoke all on public.reports from anon,authenticated;
grant all on public.reports to service_role;

create table public.user_blocks(
 blocker_id uuid not null references auth.users(id),blocked_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),primary key(blocker_id,blocked_id),check(blocker_id<>blocked_id));
create index user_blocks_reverse on public.user_blocks(blocked_id,blocker_id);
create table public.openvideo_moderators(user_id uuid primary key references auth.users(id),created_at timestamptz not null default now());
create table public.moderation_actions(id bigint generated always as identity primary key,actor_id uuid not null references auth.users(id),report_id uuid references public.reports(id),action text not null,note text not null default '',created_at timestamptz not null default now());
create index moderation_actions_report on public.moderation_actions(report_id);
create table public.openvideo_rate_limits(actor_id uuid not null references auth.users(id),scope text not null,window_start timestamptz not null,used integer not null,primary key(actor_id,scope));
alter table public.user_blocks enable row level security;
alter table public.openvideo_moderators enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.openvideo_rate_limits enable row level security;
revoke all on public.user_blocks,public.openvideo_moderators,public.moderation_actions,public.openvideo_rate_limits from anon,authenticated;
grant all on public.user_blocks,public.openvideo_moderators,public.moderation_actions,public.openvideo_rate_limits to service_role;
grant usage,select on sequence public.moderation_actions_id_seq to service_role;

create function public.openvideo_consume_limit(p_actor uuid,p_scope text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare result integer;
begin
 if p_actor is null or p_limit<1 or p_seconds<1 then return false;end if;
 insert into public.openvideo_rate_limits as r values(p_actor,p_scope,clock_timestamp(),1)
 on conflict(actor_id,scope) do update set
 used=case when r.window_start <= clock_timestamp()-make_interval(secs=>p_seconds) then 1 else r.used+1 end,
 window_start=case when r.window_start <= clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else r.window_start end
 where r.window_start <= clock_timestamp()-make_interval(secs=>p_seconds) or r.used<p_limit returning used into result;
 return result is not null;
end $$;
revoke execute on function public.openvideo_consume_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.openvideo_consume_limit(uuid,text,integer,integer) to service_role;

create function public.openvideo_blocked_pair(p_a uuid,p_b uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.user_blocks where (blocker_id=p_a and blocked_id=p_b) or (blocker_id=p_b and blocked_id=p_a));
$$;
revoke execute on function public.openvideo_blocked_pair(uuid,uuid) from public,anon,authenticated;
grant execute on function public.openvideo_blocked_pair(uuid,uuid) to service_role;
create schema if not exists openvideo_private;
revoke all on schema openvideo_private from public,anon,authenticated;
grant usage on schema openvideo_private to anon,authenticated;
create function openvideo_private.blocked_for_me(p_other uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.openvideo_blocked_pair(auth.uid(),p_other);
$$;
create function openvideo_private.adult_viewer() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and date_of_birth<=current_date-interval '18 years');
$$;
revoke execute on all functions in schema openvideo_private from public;
grant execute on function openvideo_private.blocked_for_me(uuid),openvideo_private.adult_viewer() to anon,authenticated;

alter table public.videos add column safety_hidden boolean not null default false;
alter table public.video_comments add column safety_hidden boolean not null default false;
alter table public.live_sessions add column safety_hidden boolean not null default false;
alter table public.live_messages add column safety_hidden boolean not null default false;
-- Owners can inspect their own uploads; everyone else's reads must pass these additional rules.
create policy openvideo_video_safety on public.videos as restrictive for select to anon,authenticated using(
 exists(select 1 from public.channels c where c.id=channel_id and
 (c.owner_id=auth.uid() or (not safety_hidden and not openvideo_private.blocked_for_me(c.owner_id) and (not age_restricted or openvideo_private.adult_viewer())))));
create policy openvideo_comment_safety on public.video_comments as restrictive for select to anon,authenticated using(not safety_hidden and not openvideo_private.blocked_for_me(user_id));
-- Restrict INSERT privileges so clients cannot write the newly added moderation flag.
revoke insert,update on public.video_comments from anon,authenticated;
grant insert(video_id,user_id,body) on public.video_comments to authenticated;

create function openvideo_private.validate_interaction() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_user uuid;scope_name text;
begin
 if auth.uid() is null then return new;end if;
 if tg_table_name='channel_follows' then select owner_id into owner_user from public.channels where id=new.channel_id;scope_name='follow';
 else select c.owner_id into owner_user from public.videos v join public.channels c on c.id=v.channel_id where v.id=new.video_id and not v.safety_hidden and v.status='published' and v.visibility='public';scope_name='interaction';end if;
 if owner_user is null or public.openvideo_blocked_pair(auth.uid(),owner_user) then raise exception 'Interaction unavailable' using errcode='42501';end if;
 if tg_table_name='video_comments' then
   if char_length(btrim(new.body)) not between 1 and 2000 then raise exception 'Invalid comment' using errcode='22023';end if;
   scope_name='video-comment';
 end if;
 if not public.openvideo_consume_limit(auth.uid(),scope_name,case when scope_name='video-comment' then 1 else 20 end,case when scope_name='video-comment' then 2 else 60 end) then raise exception 'Please wait before trying again' using errcode='P0001';end if;
 return new;
end $$;
revoke execute on function openvideo_private.validate_interaction() from public,anon,authenticated;
create trigger openvideo_guard_comment before insert on public.video_comments for each row execute function openvideo_private.validate_interaction();
create trigger openvideo_guard_follow before insert on public.channel_follows for each row execute function openvideo_private.validate_interaction();
create trigger openvideo_guard_like before insert on public.video_likes for each row execute function openvideo_private.validate_interaction();

-- Atomic review + content moderation + audit. Only a separately appointed moderator is trusted.
create function public.openvideo_review_report(p_actor uuid,p_report uuid,p_action text,p_note text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.reports;
begin
 if not exists(select 1 from public.openvideo_moderators where user_id=p_actor) then raise exception 'Moderator access required' using errcode='42501';end if;
 if p_action not in ('reviewing','dismissed','resolved','hide','restore') or char_length(p_note)>2000 then raise exception 'Invalid review' using errcode='22023';end if;
 select * into r from public.reports where id=p_report for update;if not found then raise exception 'Report not found';end if;
 if p_action in ('hide','restore') then
  if r.target_kind='video' then update public.videos set safety_hidden=(p_action='hide') where id=r.target_id::uuid;
  elsif r.target_kind='live' then update public.live_sessions set safety_hidden=(p_action='hide') where id=r.target_id::uuid;
  elsif r.target_kind='comment' then update public.video_comments set safety_hidden=(p_action='hide') where id=r.target_id::uuid;
  elsif r.target_kind='live-comment' then update public.live_messages set safety_hidden=(p_action='hide') where id=r.target_id::bigint;
  else raise exception 'This report requires manual account review';end if;
 end if;
 update public.reports set status=(case when p_action in ('hide','restore') then 'resolved' else p_action end)::public.report_status,
 admin_notes=coalesce(p_note,''),resolved_at=case when p_action='reviewing' then null else now() end where id=p_report;
 insert into public.moderation_actions(actor_id,report_id,action,note) values(p_actor,p_report,p_action,coalesce(p_note,''));
 return true;
end $$;
revoke execute on function public.openvideo_review_report(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.openvideo_review_report(uuid,uuid,text,text) to service_role;
