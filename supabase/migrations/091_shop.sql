-- Shop: physical/digital products with shipping and HitPay checkout.

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  summary text,
  description text,
  image_url text,
  price numeric not null check (price > 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  stock_qty integer check (stock_qty is null or stock_qty >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  share_slug text check (share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shop_products_studio_active
on public.shop_products using btree (studio_id, is_active, sort_order, created_at desc);

create unique index if not exists uniq_shop_products_studio_share_slug
on public.shop_products (studio_id, share_slug)
where share_slug is not null;

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.shop_products(id) on delete restrict,
  payment_id uuid unique references public.payments(id) on delete set null,
  qty integer not null default 1 check (qty > 0),
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'refunded'::text])),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status = any (array['unfulfilled'::text, 'shipped'::text, 'cancelled'::text])),
  product_title_snapshot text not null,
  amount numeric not null default 0 check (amount >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  shipping_name text not null,
  shipping_phone text not null,
  shipping_address_line1 text not null,
  shipping_address_line2 text,
  shipping_city text not null,
  shipping_postal_code text not null,
  shipping_country text not null default 'SG',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_shop_orders_studio_status
on public.shop_orders using btree (studio_id, status, created_at desc);

create index if not exists idx_shop_orders_client_status
on public.shop_orders using btree (client_id, status, created_at desc);

alter table public.payments
add column if not exists shop_product_id uuid references public.shop_products(id) on delete set null,
add column if not exists shop_product_name_snapshot text;

alter table public.studios
add column if not exists public_shop_title text;

alter table public.user_profiles
add column if not exists shipping_name text,
add column if not exists shipping_phone text,
add column if not exists shipping_address_line1 text,
add column if not exists shipping_address_line2 text,
add column if not exists shipping_city text,
add column if not exists shipping_postal_code text,
add column if not exists shipping_country text default 'SG';

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
  'shop_purchase'::text
]));

-- Atomically decrement stock when payment completes.
create or replace function public.decrement_shop_product_stock(p_product_id uuid, p_qty integer default 1)
returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_stock integer;
  v_updated integer;
begin
  select stock_qty into v_stock from public.shop_products where id = p_product_id;
  if not found then
    return false;
  end if;
  if v_stock is null then
    return true;
  end if;
  if v_stock < p_qty then
    return false;
  end if;

  update public.shop_products
  set stock_qty = stock_qty - p_qty,
      updated_at = now()
  where id = p_product_id
    and stock_qty is not null
    and stock_qty >= p_qty;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Extend payment expiry sweep to sync shop_orders.
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
  set status = 'expired',
      updated_at = now()
  from public.payments p
  where so.payment_id = p.id
    and so.status = 'pending'
    and p.status in ('expired', 'failed', 'cancelled');

  return updated_count;
end;
$$;
