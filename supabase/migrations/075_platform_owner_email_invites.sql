create table if not exists public.platform_owner_email_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  invited_by uuid null references public.users(id) on delete set null,
  accepted_user_id uuid null references public.users(id) on delete set null,
  accepted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_owner_email_invites_active
  on public.platform_owner_email_invites(is_active);

create index if not exists idx_platform_owner_email_invites_email
  on public.platform_owner_email_invites(email);
