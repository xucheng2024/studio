create table if not exists public.membership_products (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  description text,
  price numeric not null check (price >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  billing_interval text not null check (billing_interval = any (array['monthly'::text, 'yearly'::text])),
  is_active boolean not null default true,
  share_slug text check (share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'::text),
  image_url text,
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_membership_products_studio_active
on public.membership_products using btree (studio_id, is_active, created_at desc)
where deleted_at is null;

create table if not exists public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.users(id) on delete cascade,
  membership_product_id uuid not null references public.membership_products(id) on delete restrict,
  recurring_billing_id text unique,
  reference_code text not null unique,
  status text not null default 'scheduled'
    check (status = any (array['scheduled'::text, 'active'::text, 'retrying'::text, 'inactive'::text, 'paused'::text, 'canceled'::text])),
  customer_name_snapshot text,
  customer_email_snapshot text,
  membership_name_snapshot text,
  membership_price_snapshot numeric,
  billing_interval_snapshot text check (billing_interval_snapshot is null or billing_interval_snapshot = any (array['monthly'::text, 'yearly'::text])),
  checkout_url text,
  last_charge_at timestamptz,
  payment_method_attached_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  gateway_payload text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_subscriptions_client_created_desc
on public.customer_subscriptions using btree (client_id, created_at desc);

create index if not exists idx_customer_subscriptions_studio_status
on public.customer_subscriptions using btree (studio_id, status, created_at desc);

alter table public.payments
add column if not exists membership_product_id uuid references public.membership_products(id) on delete set null,
add column if not exists customer_subscription_id uuid references public.customer_subscriptions(id) on delete set null,
add column if not exists membership_name_snapshot text;

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
  'membership_subscription'::text
]));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_type_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_type_check;
  end if;
end $$;

alter table public.payments
add constraint payments_type_check
check (type = any (array['single'::text, 'package'::text, 'subscription'::text]));
