alter table public.channels
add column if not exists website_url text,
add column if not exists instagram_url text,
add column if not exists tiktok_url text,
add column if not exists youtube_url text,
add column if not exists x_url text;

select 'OpenVideo V7.2 Creator About + Links ready!' as status;
