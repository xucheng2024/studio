alter table public.studio_services
add column if not exists tags text[];

alter table public.classes
add column if not exists tags text[];
