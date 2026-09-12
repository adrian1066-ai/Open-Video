-- OpenVideo V6.5
-- Real views remain public, but a creator viewing their own video does not add a view.

create or replace function public.increment_video_view(video_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  update public.videos v
  set view_count = v.view_count + 1
  where v.id = video_id
    and v.visibility = 'public'
    and v.status = 'published'
    and not exists (
      select 1
      from public.channels c
      where c.id = v.channel_id
        and c.owner_id = auth.uid()
    )
  returning v.view_count into new_count;

  if new_count is null then
    select v.view_count
      into new_count
    from public.videos v
    where v.id = video_id;
  end if;

  return coalesce(new_count, 0);
end;
$$;

grant execute on function public.increment_video_view(uuid) to anon, authenticated;

select 'OpenVideo V6.5 studio views + owner exclusion ready!' as status;
