grant insert, update, delete on table public.events to authenticated;
grant insert, update, delete on table public.membership_products to authenticated;
grant insert, update, delete on table public.member_zone_series to authenticated;
grant insert, update, delete on table public.member_zone_lessons to authenticated;

revoke select on table public.member_zone_lessons from anon;

drop policy if exists member_zone_lessons_public_read_active on public.member_zone_lessons;
