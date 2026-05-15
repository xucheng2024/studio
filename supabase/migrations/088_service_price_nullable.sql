-- Services can be listed without a public price.
alter table public.studio_services
  alter column price drop not null;
