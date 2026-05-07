-- Events: remove location dependency and use free-form address.

-- Enable pg_trgm for optional address search index.
create extension if not exists pg_trgm;

alter table public.events
add column if not exists address text,
add column if not exists address_details text;

create index if not exists idx_events_address_trgm
on public.events using gin (address gin_trgm_ops);

