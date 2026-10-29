-- The booking settings page applies the recommended setup automatically once,
-- the first time a studio has a location, staff who take appointments and an
-- active service. This marker keeps it to once, so later deliberate changes
-- are never refilled. Studios that already configured opening hours are
-- treated as set up.

alter table public.studios
  add column if not exists booking_setup_auto_applied_at timestamptz;

update public.studios s
set booking_setup_auto_applied_at = now()
where s.booking_setup_auto_applied_at is null
  and exists (select 1 from public.location_operating_hours h where h.studio_id = s.id);
