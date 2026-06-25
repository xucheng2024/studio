grant select on table public.event_bookings to authenticated;
grant select on table public.customer_subscriptions to authenticated;
grant select on table public.member_zone_purchases to authenticated;

alter table public.events enable row level security;
alter table public.membership_products enable row level security;
alter table public.member_zone_series enable row level security;
alter table public.member_zone_lessons enable row level security;
alter table public.studio_content_updates enable row level security;

revoke all on table public.events from public;
revoke all on table public.events from anon;
revoke all on table public.events from authenticated;
grant select on table public.events to anon;
grant select on table public.events to authenticated;
grant all on table public.events to service_role;

revoke all on table public.membership_products from public;
revoke all on table public.membership_products from anon;
revoke all on table public.membership_products from authenticated;
grant select on table public.membership_products to anon;
grant select on table public.membership_products to authenticated;
grant all on table public.membership_products to service_role;

revoke all on table public.member_zone_series from public;
revoke all on table public.member_zone_series from anon;
revoke all on table public.member_zone_series from authenticated;
grant select on table public.member_zone_series to anon;
grant select on table public.member_zone_series to authenticated;
grant all on table public.member_zone_series to service_role;

revoke all on table public.member_zone_lessons from public;
revoke all on table public.member_zone_lessons from anon;
revoke all on table public.member_zone_lessons from authenticated;
grant select on table public.member_zone_lessons to anon;
grant select on table public.member_zone_lessons to authenticated;
grant all on table public.member_zone_lessons to service_role;

revoke all on table public.studio_content_updates from public;
revoke all on table public.studio_content_updates from anon;
revoke all on table public.studio_content_updates from authenticated;
grant all on table public.studio_content_updates to service_role;

drop policy if exists events_public_read_active on public.events;
create policy events_public_read_active
on public.events
for select
using (is_active = true);

drop policy if exists events_staff_read_all on public.events;
create policy events_staff_read_all
on public.events
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = events.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text, 'instructor'::text])
        )
      )
  )
);

drop policy if exists events_staff_write_all on public.events;
create policy events_staff_write_all
on public.events
for all
using (
  exists (
    select 1
    from public.studios s
    where s.id = events.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.studios s
    where s.id = events.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
);

drop policy if exists membership_products_public_read_active on public.membership_products;
create policy membership_products_public_read_active
on public.membership_products
for select
using (is_active = true and deleted_at is null);

drop policy if exists membership_products_staff_read_all on public.membership_products;
create policy membership_products_staff_read_all
on public.membership_products
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = membership_products.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])
        )
      )
  )
);

drop policy if exists membership_products_staff_write_all on public.membership_products;
create policy membership_products_staff_write_all
on public.membership_products
for all
using (
  exists (
    select 1
    from public.studios s
    where s.id = membership_products.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.studios s
    where s.id = membership_products.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
);

drop policy if exists member_zone_series_public_read_active on public.member_zone_series;
create policy member_zone_series_public_read_active
on public.member_zone_series
for select
using (is_active = true);

drop policy if exists member_zone_series_staff_read_all on public.member_zone_series;
create policy member_zone_series_staff_read_all
on public.member_zone_series
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = member_zone_series.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])
        )
      )
  )
);

drop policy if exists member_zone_series_staff_write_all on public.member_zone_series;
create policy member_zone_series_staff_write_all
on public.member_zone_series
for all
using (
  exists (
    select 1
    from public.studios s
    where s.id = member_zone_series.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.studios s
    where s.id = member_zone_series.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
);

drop policy if exists member_zone_lessons_public_read_active on public.member_zone_lessons;
create policy member_zone_lessons_public_read_active
on public.member_zone_lessons
for select
using (
  is_active = true
  and exists (
    select 1
    from public.member_zone_series mzs
    where mzs.id = member_zone_lessons.series_id
      and mzs.is_active = true
  )
);

drop policy if exists member_zone_lessons_staff_read_all on public.member_zone_lessons;
create policy member_zone_lessons_staff_read_all
on public.member_zone_lessons
for select
using (
  exists (
    select 1
    from public.member_zone_series mzs
    join public.studios s on s.id = mzs.studio_id
    where mzs.id = member_zone_lessons.series_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])
        )
      )
  )
);

drop policy if exists member_zone_lessons_staff_write_all on public.member_zone_lessons;
create policy member_zone_lessons_staff_write_all
on public.member_zone_lessons
for all
using (
  exists (
    select 1
    from public.member_zone_series mzs
    join public.studios s on s.id = mzs.studio_id
    where mzs.id = member_zone_lessons.series_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.member_zone_series mzs
    join public.studios s on s.id = mzs.studio_id
    where mzs.id = member_zone_lessons.series_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1
          from public.staff_memberships sm
          where sm.studio_id = s.id
            and sm.user_id = auth.uid()
            and sm.is_active = true
            and sm.role = any (array['owner'::text, 'manager'::text])
        )
      )
  )
);
