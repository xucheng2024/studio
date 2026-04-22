-- Studio public landing page fields + studio services catalog.

alter table public.studios
  add column if not exists public_intro text null,
  add column if not exists public_cover_image_url text null,
  add column if not exists public_gallery_images jsonb null,
  add column if not exists public_video_url text null,
  add column if not exists whatsapp_enabled boolean not null default false,
  add column if not exists whatsapp_number_e164 text null,
  add column if not exists whatsapp_prefill_text text null;

create table if not exists public.studio_services (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  summary text null,
  description text null,
  price numeric(12,2) not null,
  currency text not null default 'SGD',
  cover_image_url text null,
  gallery_images jsonb null,
  video_url text null,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_studio_services_studio_active_sort
  on public.studio_services(studio_id, is_active, sort_order, created_at desc);

create or replace function public.set_studio_services_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_studio_services_updated_at on public.studio_services;
create trigger trg_studio_services_updated_at
before update on public.studio_services
for each row execute function public.set_studio_services_updated_at();

alter table public.studio_services enable row level security;

drop policy if exists "studio_services_read_public_active" on public.studio_services;
create policy "studio_services_read_public_active"
  on public.studio_services
  for select
  using (is_active = true);

drop policy if exists "studio_services_staff_read" on public.studio_services;
create policy "studio_services_staff_read"
  on public.studio_services
  for select
  using (
    exists (
      select 1
      from public.studios s
      where s.id = studio_services.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role in ('owner', 'manager')
          )
        )
    )
  );

drop policy if exists "studio_services_staff_write" on public.studio_services;
create policy "studio_services_staff_write"
  on public.studio_services
  for all
  using (
    exists (
      select 1
      from public.studios s
      where s.id = studio_services.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role in ('owner', 'manager')
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.studios s
      where s.id = studio_services.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role in ('owner', 'manager')
          )
        )
    )
  );
