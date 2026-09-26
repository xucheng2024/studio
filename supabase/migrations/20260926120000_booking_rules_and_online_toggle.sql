-- Customer self-booking rules per studio and a per-service online booking switch.
-- Enforced in the server layer that all customer self-service writes go through.

alter table public.studios
  add column if not exists appointment_min_notice_minutes integer not null default 60,
  add column if not exists appointment_max_advance_days integer not null default 60,
  add column if not exists appointment_change_cutoff_hours integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studios_appointment_min_notice_minutes_check') then
    alter table public.studios
      add constraint studios_appointment_min_notice_minutes_check
      check (appointment_min_notice_minutes between 0 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studios_appointment_max_advance_days_check') then
    alter table public.studios
      add constraint studios_appointment_max_advance_days_check
      check (appointment_max_advance_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studios_appointment_change_cutoff_hours_check') then
    alter table public.studios
      add constraint studios_appointment_change_cutoff_hours_check
      check (appointment_change_cutoff_hours between 0 and 168);
  end if;
end;
$$;

alter table public.studio_services
  add column if not exists online_bookable boolean not null default true;
