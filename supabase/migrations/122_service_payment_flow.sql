alter table public.studio_services
add column if not exists enable_enquiry boolean not null default true,
add column if not exists enable_payment boolean not null default false;

alter table public.payments
add column if not exists service_id uuid references public.studio_services(id) on delete set null,
add column if not exists service_title_snapshot text;

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  service_id uuid not null references public.studio_services(id) on delete restrict,
  payment_id uuid unique references public.payments(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  note text,
  service_title_snapshot text not null,
  amount numeric not null default 0 check (amount >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'refunded'::text])),
  fulfillment_status text not null default 'new'
    check (fulfillment_status = any (array['new'::text, 'in_progress'::text, 'fulfilled'::text, 'cancelled'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  constraint service_orders_client_or_guest
    check (
      client_id is not null
      or (
        guest_name is not null and btrim(guest_name) <> ''
        and guest_email is not null and btrim(guest_email) <> ''
      )
    )
);

create index if not exists idx_service_orders_studio_status
on public.service_orders using btree (studio_id, status, created_at desc);

create index if not exists idx_service_orders_client_status
on public.service_orders using btree (client_id, status, created_at desc);

create index if not exists idx_service_orders_service_status
on public.service_orders using btree (service_id, status, created_at desc);

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
  'walkin'::text,
  'online_booking'::text,
  'package_buy'::text,
  'event_booking'::text,
  'membership_subscription'::text,
  'member_zone_purchase'::text,
  'shop_purchase'::text,
  'service_purchase'::text
]));

create or replace function public.expire_pending_payments()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id, event_booking_id
    from public.payments
    where status = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  for r in
    select id, booking_id, event_booking_id
    from public.payments
    where status = 'pending'
      and expires_at is null
      and created_at < now() - interval '2 hours'
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  for r in
    select b.id as booking_id, b.session_id
    from public.bookings b
    join public.payments p on p.id = b.payment_id
    where b.status = 'pending'
      and p.status in ('failed', 'expired', 'cancelled')
    for update of b
  loop
    update public.bookings
      set status = 'cancelled', payment_status = 'expired'
    where id = r.booking_id and status = 'pending';

    if found then
      update public.class_sessions
        set spots_left = spots_left + 1
      where id = r.session_id;

      updated_count := updated_count + 1;
    end if;
  end loop;

  update public.member_zone_purchases mzp
  set status = 'expired',
      updated_at = now()
  from public.payments p
  where mzp.payment_id = p.id
    and mzp.status = 'pending'
    and p.status in ('expired', 'failed', 'cancelled');

  update public.shop_orders so
  set status = case
      when p.status in ('failed', 'cancelled') then 'failed'
      else 'expired'
    end,
    updated_at = now()
  from public.payments p
  where so.payment_id = p.id
    and so.status in ('pending', 'processing')
    and p.status in ('expired', 'failed', 'cancelled');

  update public.shop_orders
  set status = 'failed',
      updated_at = now()
  where status = 'processing'
    and updated_at < now() - interval '10 minutes';

  update public.service_orders so
  set status = case
      when p.status in ('failed', 'cancelled') then 'failed'
      else 'expired'
    end,
    fulfillment_status = case
      when so.fulfillment_status = 'fulfilled' then so.fulfillment_status
      else 'cancelled'
    end,
    updated_at = now()
  from public.payments p
  where so.payment_id = p.id
    and so.status = 'pending'
    and p.status in ('expired', 'failed', 'cancelled');

  return updated_count;
end;
$$;

alter table public.service_orders enable row level security;

revoke all on table public.service_orders from public;
revoke all on table public.service_orders from anon;
revoke all on table public.service_orders from authenticated;
grant all on table public.service_orders to service_role;
grant select on table public.service_orders to authenticated;

drop policy if exists service_orders_self_read on public.service_orders;
create policy service_orders_self_read
on public.service_orders
for select
using (auth.uid() = client_id);

drop policy if exists service_orders_staff_read_all on public.service_orders;
create policy service_orders_staff_read_all
on public.service_orders
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = service_orders.studio_id
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

drop policy if exists service_orders_staff_update on public.service_orders;
create policy service_orders_staff_update
on public.service_orders
for update
using (
  exists (
    select 1
    from public.studios s
    where s.id = service_orders.studio_id
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
    where s.id = service_orders.studio_id
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
