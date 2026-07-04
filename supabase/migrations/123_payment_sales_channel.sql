alter table public.payments
add column if not exists sales_channel text;

update public.payments
set sales_channel = case
  when source = 'walkin' then 'frontdesk'
  else 'online'
end
where sales_channel is null;

update public.payments
set source = case
  when event_booking_id is not null then 'event_booking'
  when booking_id is not null then 'online_booking'
  else 'online_booking'
end
where source = 'walkin';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_source_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_source_check;
  end if;
end $$;

alter table public.payments
add constraint payments_source_check
check (source = any (array[
  'online_booking'::text,
  'package_buy'::text,
  'event_booking'::text,
  'membership_subscription'::text,
  'member_zone_purchase'::text,
  'shop_purchase'::text,
  'service_purchase'::text
]));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_sales_channel_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_sales_channel_check;
  end if;
end $$;

alter table public.payments
alter column sales_channel set default 'online',
alter column sales_channel set not null;

alter table public.payments
add constraint payments_sales_channel_check
check (sales_channel = any (array[
  'online'::text,
  'frontdesk'::text,
  'dashboard'::text,
  'system'::text
]));
