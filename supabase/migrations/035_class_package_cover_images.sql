-- Cover images for public class / package share pages (Supabase Storage URLs in DB).

alter table public.classes
  add column if not exists image_url text null,
  add column if not exists image_updated_at timestamptz null;

alter table public.packages
  add column if not exists image_url text null,
  add column if not exists image_updated_at timestamptz null;

comment on column public.classes.image_url is 'Public URL of cover image in storage bucket public-media';
comment on column public.packages.image_url is 'Public URL of cover image in storage bucket public-media';

-- Public bucket for share-page and og:image (readable without auth).
insert into storage.buckets (id, name, public, file_size_limit)
values ('public-media', 'public-media', true, 5242880)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Anyone can read objects (crawlers, <img>, og:image).
drop policy if exists "public_media_select" on storage.objects;
create policy "public_media_select"
  on storage.objects for select
  using (bucket_id = 'public-media');

-- Writes go through the service role (Next.js API); no insert policy for anon.
