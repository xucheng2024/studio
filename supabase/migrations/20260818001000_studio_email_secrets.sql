alter table public.studios
  add column if not exists resend_enabled boolean not null default false;

create table if not exists public.studio_email_secrets (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  resend_api_key text,
  resend_from_email text,
  resend_webhook_secret text,
  updated_at timestamptz not null default now()
);

alter table public.studio_email_secrets enable row level security;

revoke all on table public.studio_email_secrets from public;
revoke all on table public.studio_email_secrets from anon;
revoke all on table public.studio_email_secrets from authenticated;
grant all on table public.studio_email_secrets to service_role;
