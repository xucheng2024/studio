alter table public.studios
  drop column if exists calcom_booking_enabled,
  drop column if exists calcom_embed_url;
