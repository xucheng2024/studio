alter table public.studios
  add column if not exists calcom_booking_enabled boolean not null default false,
  add column if not exists calcom_embed_url text;
