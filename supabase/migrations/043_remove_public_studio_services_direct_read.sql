-- Prevent anonymous platform-wide service enumeration via PostgREST.
-- Public landing pages should read through controlled server-side code paths.

drop policy if exists "studio_services_read_public_active" on public.studio_services;
