-- Class & package lifecycle (soft disable) + share slugs for public links.

alter table public.classes
  add column if not exists is_active boolean not null default true;

alter table public.classes
  add column if not exists share_slug text;

alter table public.classes
  add column if not exists updated_at timestamptz not null default now();

alter table public.classes
  drop constraint if exists classes_share_slug_format;

alter table public.classes
  add constraint classes_share_slug_format check (
    share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'
  );

drop index if exists idx_classes_studio_share_slug;

create unique index idx_classes_studio_share_slug
  on public.classes (studio_id, share_slug)
  where share_slug is not null;

alter table public.packages
  add column if not exists share_slug text;

alter table public.packages
  add column if not exists updated_at timestamptz not null default now();

alter table public.packages
  add column if not exists is_active boolean not null default true;

alter table public.packages
  drop constraint if exists packages_share_slug_format;

alter table public.packages
  add constraint packages_share_slug_format check (
    share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'
  );

drop index if exists idx_packages_studio_share_slug;

create unique index idx_packages_studio_share_slug
  on public.packages (studio_id, share_slug)
  where share_slug is not null;

create or replace function public.touch_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists classes_touch_updated_at on public.classes;

create trigger classes_touch_updated_at
  before update on public.classes
  for each row
  execute function public.touch_row_updated_at();

drop trigger if exists packages_touch_updated_at on public.packages;

create trigger packages_touch_updated_at
  before update on public.packages
  for each row
  execute function public.touch_row_updated_at();
