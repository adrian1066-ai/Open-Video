-- Additive change: existing recordings remain stored and become private drafts.
alter table public.live_sessions
  add column category text not null default 'Community' check (char_length(category) between 1 and 60),
  add column country text check (char_length(country) between 1 and 80),
  add column city text check (char_length(city) between 1 and 80),
  add column started_at timestamptz,
  add column recording_enabled boolean not null default true,
  add column replay_published_at timestamptz;
alter table public.live_sessions drop constraint live_sessions_replay_state_check;
alter table public.live_sessions add constraint live_sessions_replay_state_check
  check (replay_state in ('recording','uploading','ready','incomplete','disabled'));
alter table public.live_sessions add constraint live_replay_publication_ready
  check (replay_published_at is null or (state = 'ended' and replay_state = 'ready'));
create index live_published_replays on public.live_sessions(replay_published_at desc)
  where replay_published_at is not null;
comment on column public.live_sessions.replay_published_at is 'NULL means private creator draft. Finalizing never publishes.';
comment on column public.live_sessions.country is 'Optional creator-entered coarse location. No device coordinates.';
