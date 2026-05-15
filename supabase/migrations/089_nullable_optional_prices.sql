-- Optional pricing fields should allow null when left empty in admin forms.
alter table public.class_sessions
  alter column guest_price drop not null,
  alter column guest_price drop default;

alter table public.member_zone_series
  alter column price drop not null,
  alter column price drop default;

alter table public.member_zone_lessons
  alter column override_price drop not null,
  alter column override_price drop default;
