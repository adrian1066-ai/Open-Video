-- Preserve data and existing RLS; restrict client-editable columns.
revoke all on public.profiles from anon, authenticated;
grant select(id,username,display_name,bio,avatar_url,banner_url,country,language,is_creator,is_verified,created_at,updated_at) on public.profiles to anon,authenticated;
grant update(username,display_name,bio,avatar_url,banner_url,country,language) on public.profiles to authenticated;
revoke insert,update,truncate,references,trigger on public.channels from anon,authenticated;
grant insert(owner_id,handle,name,description,avatar_url,banner_url,website_url,instagram_url,tiktok_url,youtube_url,x_url) on public.channels to authenticated;
grant update(handle,name,description,avatar_url,banner_url,website_url,instagram_url,tiktok_url,youtube_url,x_url) on public.channels to authenticated;
revoke truncate,references,trigger on public.videos,public.video_comments,public.reports from anon,authenticated;
revoke insert,update on public.videos from anon,authenticated;
grant insert(channel_id,category_id,title,description,thumbnail_url,video_url,visibility,status,published_at,monetization,allow_comments,age_restricted,is_ai_generated) on public.videos to authenticated;
grant update(category_id,title,description,thumbnail_url,visibility,status,published_at,allow_comments,age_restricted,is_ai_generated) on public.videos to authenticated;

-- Trigger validates file ownership before publishing a new video record.
create function public.openvideo_validate_upload() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is not null and
    (split_part(new.video_url,'/',1) <> auth.uid()::text or new.video_url like '%..%' or new.video_url like '%://%') then
   raise exception 'Invalid upload owner' using errcode='42501';
 end if;
 if char_length(btrim(new.title)) not between 1 and 160 or char_length(coalesce(new.description,''))>10000 then
   raise exception 'Invalid video details' using errcode='22023';
 end if;
 return new;
end $$;
revoke execute on function public.openvideo_validate_upload() from public,anon,authenticated;
create trigger openvideo_validate_upload before insert or update of title,description,video_url on public.videos
for each row execute function public.openvideo_validate_upload();
update storage.buckets set file_size_limit=104857600,allowed_mime_types=array['video/mp4','video/webm','video/quicktime','video/ogg'] where id='videos';
alter function public.set_updated_at() set search_path=public,pg_temp;
alter function public.get_following_feed_v73() set search_path=public,pg_temp;
