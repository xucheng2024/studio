-- Add custom_domain to studios so studio owners can map their own domain
-- to their studio public page.

alter table public.studios
  add column if not exists custom_domain text;

create unique index if not exists studios_custom_domain_lower
  on public.studios (lower(custom_domain))
  where custom_domain is not null;
