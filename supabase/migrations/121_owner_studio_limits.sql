alter table public.platform_owner_grants
  add column if not exists studio_limit integer not null default 1;

alter table public.platform_owner_grants
  drop constraint if exists platform_owner_grants_studio_limit_check;

alter table public.platform_owner_grants
  add constraint platform_owner_grants_studio_limit_check
  check (studio_limit >= 1);

alter table public.platform_owner_email_invites
  add column if not exists studio_limit integer not null default 1;

alter table public.platform_owner_email_invites
  drop constraint if exists platform_owner_email_invites_studio_limit_check;

alter table public.platform_owner_email_invites
  add constraint platform_owner_email_invites_studio_limit_check
  check (studio_limit >= 1);
