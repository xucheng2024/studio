create table if not exists public.platform_owner_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  location_id uuid references public.locations (id) on delete set null,
  email text not null,
  role text not null check (role in ('manager', 'frontdesk', 'instructor')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users (id) on delete restrict,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_invites_studio_status
  on public.staff_invites (studio_id, status);

create index if not exists idx_staff_invites_email_status
  on public.staff_invites (email, status);

create unique index if not exists idx_staff_invites_pending_unique
  on public.staff_invites (studio_id, lower(email))
  where status = 'pending';

-- Replace legacy studio owner policy that depended on public.users.role
drop policy if exists "studios_owner_write" on public.studios;

create policy "studios_owner_write" on public.studios
  for all
  using (
    auth.uid() = owner_id
    and (
      exists (
        select 1
        from public.platform_owner_grants g
        where g.user_id = auth.uid()
          and g.is_active = true
      )
      or exists (
        select 1
        from public.staff_memberships sm
        where sm.user_id = auth.uid()
          and sm.studio_id = public.studios.id
          and sm.role = 'owner'
          and sm.is_active = true
      )
    )
  )
  with check (
    auth.uid() = owner_id
    and (
      exists (
        select 1
        from public.platform_owner_grants g
        where g.user_id = auth.uid()
          and g.is_active = true
      )
      or exists (
        select 1
        from public.staff_memberships sm
        where sm.user_id = auth.uid()
          and sm.studio_id = public.studios.id
          and sm.role = 'owner'
          and sm.is_active = true
      )
    )
  );

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  drop column if exists role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (
    new.id,
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
