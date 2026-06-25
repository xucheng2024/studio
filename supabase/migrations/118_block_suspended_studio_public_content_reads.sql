drop policy if exists events_public_read_active on public.events;
create policy events_public_read_active
on public.events
for select
using (
  is_active = true
  and exists (
    select 1
    from public.studios s
    where s.id = events.studio_id
      and coalesce(s.contract_status, 'active') <> 'suspended'
  )
);

drop policy if exists membership_products_public_read_active on public.membership_products;
create policy membership_products_public_read_active
on public.membership_products
for select
using (
  is_active = true
  and deleted_at is null
  and exists (
    select 1
    from public.studios s
    where s.id = membership_products.studio_id
      and coalesce(s.contract_status, 'active') <> 'suspended'
  )
);

drop policy if exists member_zone_series_public_read_active on public.member_zone_series;
create policy member_zone_series_public_read_active
on public.member_zone_series
for select
using (
  is_active = true
  and exists (
    select 1
    from public.studios s
    where s.id = member_zone_series.studio_id
      and coalesce(s.contract_status, 'active') <> 'suspended'
  )
);
