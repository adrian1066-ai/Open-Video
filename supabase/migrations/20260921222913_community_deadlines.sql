-- Service broker may invoke these private helpers; clients still cannot.
grant usage on schema openvideo_private to service_role;
grant execute on function openvideo_private.notify(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function openvideo_private.award_xp(uuid,text,uuid,integer) to service_role;

create function openvideo_private.process_deadlines() returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
 for item in select ent.id,ent.user_id,ent.deadline,ch.title from public.openvideo_challenge_entries ent join public.openvideo_challenges ch on ch.id=ent.challenge_id where ent.status='accepted' and ent.deadline>now() and ent.deadline<=now()+interval '2 minutes' loop
  perform openvideo_private.notify(item.user_id,null,'deadline','Challenge deadline approaching',item.title,'challenge-deadline:'||item.id,'challenges');
 end loop;
 update public.openvideo_challenge_entries set status='expired' where status='accepted' and deadline<now();
 update public.openvideo_requests set status='expired' where status in ('requested','accepted') and deadline<now();
 update public.openvideo_mission_entries ent set status='expired' from public.openvideo_missions mi where ent.mission_id=mi.id and ent.status='accepted' and mi.deadline<now();
 for item in select ent.id,ent.user_id,mi.title from public.openvideo_mission_entries ent join public.openvideo_missions mi on mi.id=ent.mission_id where ent.status='accepted' and mi.deadline>now() and mi.deadline<=now()+interval '1 day' loop
  perform openvideo_private.notify(item.user_id,null,'deadline','Mission deadline approaching',item.title,'mission-deadline:'||item.id,'missions');
 end loop;
end $$;
revoke execute on function openvideo_private.process_deadlines() from public,anon,authenticated;
grant execute on function openvideo_private.process_deadlines() to service_role;
create extension if not exists pg_cron;
select cron.schedule('openvideo-community-deadlines','* * * * *','select openvideo_private.process_deadlines()');
