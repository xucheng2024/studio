create table if not exists public.member_studio_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, studio_id)
);

create index if not exists idx_member_studio_memberships_user_status
  on public.member_studio_memberships (user_id, status);

create index if not exists idx_member_studio_memberships_studio_status
  on public.member_studio_memberships (studio_id, status);

create or replace function public.touch_member_studio_memberships_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_member_studio_memberships_updated_at on public.member_studio_memberships;
create trigger trg_member_studio_memberships_updated_at
before update on public.member_studio_memberships
for each row execute function public.touch_member_studio_memberships_updated_at();
