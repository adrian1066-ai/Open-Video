create table public.openvideo_levels(name text primary key check(length(name) between 2 and 60),threshold integer not null unique check(threshold>=0),benefits text not null default '' check(length(benefits)<=1000));
insert into public.openvideo_levels(name,threshold,benefits) values('Explorer',0,'Discover and participate'),('Scout',500,'Creator progression badge'),('Reporter',1500,'Creator progression badge'),('Pathfinder',4000,'Creator progression badge'),('Open Creator',10000,'Creator progression badge');
create table public.openvideo_xp_ledger(id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),source text not null check(source in ('challenge','mission')),source_id uuid not null,amount integer not null check(amount between 0 and 10000),created_at timestamptz not null default now(),unique(user_id,source,source_id));
create index openvideo_xp_user on public.openvideo_xp_ledger(user_id,created_at desc);
alter table public.openvideo_levels enable row level security;
alter table public.openvideo_xp_ledger enable row level security;
revoke all on public.openvideo_levels,public.openvideo_xp_ledger from anon,authenticated;
grant all on public.openvideo_levels,public.openvideo_xp_ledger to service_role;
grant usage,select on sequence public.openvideo_xp_ledger_id_seq to service_role;

create function openvideo_private.award_xp(p_user uuid,p_source text,p_source_id uuid,p_amount integer) returns void
language plpgsql security definer set search_path='' as $$
declare total_before bigint;total_after bigint;old_level text;new_level text;inserted integer;
begin
 -- Serialize per creator to ensure parallel awards send a level notification only once.
 perform 1 from public.profiles where id=p_user for update;
 select coalesce(sum(amount),0) into total_before from public.openvideo_xp_ledger where user_id=p_user;
 insert into public.openvideo_xp_ledger(user_id,source,source_id,amount) values(p_user,p_source,p_source_id,p_amount) on conflict(user_id,source,source_id) do nothing;
 get diagnostics inserted=row_count;if inserted=0 then return;end if;
 total_after=total_before+p_amount;
 select name into old_level from public.openvideo_levels where threshold<=total_before order by threshold desc limit 1;
 select name into new_level from public.openvideo_levels where threshold<=total_after order by threshold desc limit 1;
 if new_level is distinct from old_level then
  perform openvideo_private.notify(p_user,null,'achievement','New creator level',new_level||' · '||total_after||' XP','level:'||new_level,'progress');
 end if;
end $$;
revoke execute on function openvideo_private.award_xp(uuid,text,uuid,integer) from public,anon,authenticated;
create function openvideo_private.challenge_xp() returns trigger language plpgsql security definer set search_path='' as $$
declare points integer;
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  select xp into points from public.openvideo_challenges where id=new.challenge_id;
  perform openvideo_private.award_xp(new.user_id,'challenge',new.id,points);
 end if;return new;
end $$;
revoke execute on function openvideo_private.challenge_xp() from public,anon,authenticated;
create trigger openvideo_challenge_xp after update of status on public.openvideo_challenge_entries for each row execute function openvideo_private.challenge_xp();

create function public.openvideo_progress_action(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare target_user uuid:=p_actor;total bigint;level_row jsonb;next_row jsonb;
begin
 if p_actor is null then raise exception 'An account is required.';end if;
 if p_action<>'list' then raise exception 'Unknown progression action.';end if;
 if p_data->>'channel_id' is not null then select owner_id into target_user from public.channels where id=(p_data->>'channel_id')::uuid;end if;
 if target_user is null or public.openvideo_blocked_pair(p_actor,target_user) then raise exception 'Creator is unavailable.';end if;
 select coalesce(sum(amount),0) into total from public.openvideo_xp_ledger where user_id=target_user;
 select to_jsonb(l) into level_row from public.openvideo_levels l where threshold<=total order by threshold desc limit 1;
 select to_jsonb(l) into next_row from public.openvideo_levels l where threshold>total order by threshold limit 1;
 return jsonb_build_object('xp',total,'level',level_row,'next',next_row,'history',case when target_user=p_actor then coalesce((select jsonb_agg(to_jsonb(x)) from(select source,amount,created_at from public.openvideo_xp_ledger where user_id=p_actor order by created_at desc limit 100)x),'[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke execute on function public.openvideo_progress_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.openvideo_progress_action(uuid,text,jsonb) to service_role;
