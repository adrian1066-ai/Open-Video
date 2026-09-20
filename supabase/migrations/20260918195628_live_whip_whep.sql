-- Additive Live schema. Existing video, follow, comment and profile tables stay intact.
create table public.live_sessions (
 id uuid primary key default gen_random_uuid(),
 channel_id uuid not null references public.channels(id),
 owner_id uuid not null references auth.users(id),
 title text not null check(char_length(title) between 1 and 160),
 access text not null check(access in ('public','subscribers')),
 input_uid text not null,
 state text not null default 'starting' check(state in ('starting','live','ended')),
 replay_state text not null default 'recording' check(replay_state in ('recording','uploading','ready','incomplete')),
 created_at timestamptz not null default now(),
 heartbeat_at timestamptz not null default now(),
 ended_at timestamptz,
 segment_count integer check(segment_count between 1 and 1440)
);
create unique index live_one_input on public.live_sessions(input_uid) where state in ('starting','live');
create index live_discovery on public.live_sessions(created_at desc);
create index live_channel on public.live_sessions(channel_id);
create index live_owner on public.live_sessions(owner_id);

-- Entitlements are separate from free follows and platform Premium. Only the backend/admin grants them.
create table public.live_subscriptions (
 channel_id uuid not null references public.channels(id),
 user_id uuid not null references auth.users(id),
 expires_at timestamptz not null,
 primary key(channel_id,user_id)
);
create index live_subscription_user on public.live_subscriptions(user_id);
create table public.live_viewers (
 live_id uuid not null references public.live_sessions(id) on delete cascade,
 viewer_key text not null,
 seen_at timestamptz not null default now(),
 primary key(live_id,viewer_key)
);
create table public.live_messages (
 id bigint generated always as identity primary key,
 live_id uuid not null references public.live_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 display_name text not null,
 body text not null check(char_length(body) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index live_messages_order on public.live_messages(live_id,id desc);
create index live_messages_user on public.live_messages(user_id,created_at desc);
create table public.live_likes (
 live_id uuid not null references public.live_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 primary key(live_id,user_id)
);
create index live_likes_user on public.live_likes(user_id);
create table public.live_segments (
 live_id uuid not null references public.live_sessions(id) on delete cascade,
 ordinal integer not null check(ordinal between 0 and 1439),
 object_path text not null unique,
 mime text not null check(mime in ('video/webm','video/mp4')),
 duration_ms integer not null check(duration_ms between 1 and 120000),
 bytes integer not null check(bytes between 1 and 20971520),
 uploaded boolean not null default false,
 primary key(live_id,ordinal)
);
create table public.live_connections (
 id uuid primary key default gen_random_uuid(),
 live_id uuid not null references public.live_sessions(id) on delete cascade,
 viewer_key text not null,
 kind text not null check(kind in ('publish','play')),
 resource_url text not null,
 created_at timestamptz not null default now()
);
create index live_connections_session on public.live_connections(live_id);

-- All Live writes and reads pass through the authenticated Edge Function. No client can read credentials,
-- forge counts, grant subscriptions, publish someone else's stream, or bypass subscriber checks via REST.
do $$ declare t text; begin
 foreach t in array array['live_sessions','live_subscriptions','live_viewers','live_messages','live_likes','live_segments','live_connections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.live_messages_id_seq to service_role;

create function public.openvideo_live_config() returns jsonb
language sql security definer set search_path='' as $$
 select decrypted_secret::jsonb from vault.decrypted_secrets where name='openvideo_live_config' limit 1
$$;
revoke all on function public.openvideo_live_config() from public,anon,authenticated;
grant execute on function public.openvideo_live_config() to service_role;

create function public.openvideo_live_stats(p_ids uuid[]) returns table(live_id uuid,viewers bigint,likes bigint)
language sql security invoker set search_path='' as $$
 select s.id,
 (select count(*) from public.live_viewers v where v.live_id=s.id and v.seen_at>now()-interval '45 seconds'),
 (select count(*) from public.live_likes l where l.live_id=s.id)
 from public.live_sessions s where s.id=any(p_ids)
$$;
revoke all on function public.openvideo_live_stats(uuid[]) from public,anon,authenticated;
grant execute on function public.openvideo_live_stats(uuid[]) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('live-replays','live-replays',false,20971520,array['video/webm','video/mp4'])
 on conflict(id) do nothing;
-- No Storage client policy is granted: the backend issues scoped upload and short-lived read URLs.
