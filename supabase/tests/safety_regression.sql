-- Run on a test database with real test user/video fixtures supplied through settings.
-- All mutations are rolled back, including moderator audit entries and rate-limit rows.
begin;
do $$
declare host_user uuid:=current_setting('openvideo.test_host')::uuid;
 viewer_user uuid:=current_setting('openvideo.test_viewer')::uuid;
 moderator_user uuid:=current_setting('openvideo.test_moderator')::uuid;
 video uuid:=current_setting('openvideo.test_video')::uuid;
 report uuid;visible_count integer;
begin
 if has_column_privilege('authenticated','public.profiles','is_admin','UPDATE') then raise exception 'Role escalation possible';end if;
 if has_column_privilege('anon','public.profiles','date_of_birth','SELECT') then raise exception 'DOB exposed';end if;
 if has_table_privilege('authenticated','public.openvideo_moderators','INSERT') then raise exception 'Moderator escalation possible';end if;
 update public.videos set visibility='public',status='published',safety_hidden=false,age_restricted=false where id=video;
 perform set_config('request.jwt.claim.sub',viewer_user::text,true);
 execute 'set local role authenticated';
 select count(*) into visible_count from public.videos where id=video;
 execute 'reset role';
 if visible_count<>1 then raise exception 'Baseline public video unavailable';end if;
 insert into public.user_blocks(blocker_id,blocked_id) values(viewer_user,host_user) on conflict do nothing;
 execute 'set local role authenticated';
 select count(*) into visible_count from public.videos where id=video;
 execute 'reset role';
 if visible_count<>0 then raise exception 'Block failed to filter public video';end if;
 delete from public.user_blocks where blocker_id=viewer_user and blocked_id=host_user;
 insert into public.reports(reporter_id,target_kind,target_id,reason) values(viewer_user,'video',video::text,'other') returning id into report;
 begin
  perform public.openvideo_review_report(viewer_user,report,'hide','Regression');
  raise exception 'Unprivileged moderation allowed';
 exception when insufficient_privilege then null;
 end;
 perform public.openvideo_review_report(moderator_user,report,'hide','Regression');
 execute 'set local role authenticated';
 select count(*) into visible_count from public.videos where id=video;
 execute 'reset role';
 if visible_count<>0 then raise exception 'Moderation failed to hide video';end if;
 perform public.openvideo_review_report(moderator_user,report,'restore','Regression');
 update public.videos set age_restricted=true where id=video;
 execute 'set local role anon';
 select count(*) into visible_count from public.videos where id=video;
 execute 'reset role';
 if visible_count<>0 then raise exception 'Anonymous age gate failed';end if;
 if not public.openvideo_consume_limit(viewer_user,'regression-test',1,60) or public.openvideo_consume_limit(viewer_user,'regression-test',1,60) then raise exception 'Rate limit failed';end if;
end $$;
rollback;
