alter table studios
  add column if not exists public_events_title text,
  add column if not exists public_member_zone_title text;
