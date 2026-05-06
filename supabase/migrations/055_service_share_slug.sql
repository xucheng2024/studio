alter table public.studio_services
add column if not exists share_slug text;

alter table public.studio_services
drop constraint if exists studio_services_share_slug_format;

alter table public.studio_services
add constraint studio_services_share_slug_format
check (share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$');

create unique index if not exists idx_studio_services_studio_share_slug
on public.studio_services using btree (studio_id, share_slug)
where share_slug is not null;
