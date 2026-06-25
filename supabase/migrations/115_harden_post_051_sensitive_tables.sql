alter table public.event_bookings enable row level security;
alter table public.customer_subscriptions enable row level security;
alter table public.member_zone_purchases enable row level security;

revoke all on table public.event_bookings from public;
revoke all on table public.event_bookings from anon;
revoke all on table public.event_bookings from authenticated;
grant all on table public.event_bookings to service_role;

revoke all on table public.customer_subscriptions from public;
revoke all on table public.customer_subscriptions from anon;
revoke all on table public.customer_subscriptions from authenticated;
grant all on table public.customer_subscriptions to service_role;

revoke all on table public.member_zone_purchases from public;
revoke all on table public.member_zone_purchases from anon;
revoke all on table public.member_zone_purchases from authenticated;
grant all on table public.member_zone_purchases to service_role;

drop policy if exists event_bookings_self_read on public.event_bookings;
create policy event_bookings_self_read
on public.event_bookings
for select
using (auth.uid() = client_id);

drop policy if exists customer_subscriptions_self_read on public.customer_subscriptions;
create policy customer_subscriptions_self_read
on public.customer_subscriptions
for select
using (auth.uid() = client_id);

drop policy if exists member_zone_purchases_self_read on public.member_zone_purchases;
create policy member_zone_purchases_self_read
on public.member_zone_purchases
for select
using (auth.uid() = client_id);
