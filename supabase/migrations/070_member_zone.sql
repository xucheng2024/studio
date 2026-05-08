create table if not exists public.member_zone_series (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  summary text,
  description text,
  cover_image_url text,
  promo_video_url text,
  access_type text not null default 'members_only'
    check (access_type = any (array['free'::text, 'paid'::text, 'members_only'::text])),
  price numeric not null default 0 check (price >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  share_slug text check (share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'::text),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_zone_series_studio_active
on public.member_zone_series using btree (studio_id, is_active, sort_order, created_at desc);

create table if not exists public.member_zone_lessons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.member_zone_series(id) on delete cascade,
  title text not null,
  summary text,
  description text,
  media_url text not null,
  media_type text not null default 'video'
    check (media_type = any (array['video'::text, 'audio'::text])),
  duration_min integer not null default 0 check (duration_min >= 0),
  access_override text not null default 'inherit'
    check (access_override = any (array['inherit'::text, 'free'::text, 'paid'::text, 'members_only'::text])),
  override_price numeric not null default 0 check (override_price >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_zone_lessons_series_active
on public.member_zone_lessons using btree (series_id, is_active, sort_order, created_at asc);

create table if not exists public.member_zone_purchases (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  client_id uuid not null references public.users(id) on delete cascade,
  series_id uuid not null references public.member_zone_series(id) on delete cascade,
  lesson_id uuid references public.member_zone_lessons(id) on delete set null,
  payment_id uuid unique references public.payments(id) on delete set null,
  purchase_scope text not null default 'series'
    check (purchase_scope = any (array['series'::text, 'lesson'::text])),
  amount numeric not null default 0 check (amount >= 0::numeric),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'refunded'::text])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz
);

create index if not exists idx_member_zone_purchases_client_status
on public.member_zone_purchases using btree (client_id, status, created_at desc);

create unique index if not exists uniq_member_zone_paid_series
on public.member_zone_purchases (client_id, series_id)
where lesson_id is null and status = 'paid';

create unique index if not exists uniq_member_zone_paid_lesson
on public.member_zone_purchases (client_id, lesson_id)
where lesson_id is not null and status = 'paid';

alter table public.payments
add column if not exists member_zone_series_id uuid references public.member_zone_series(id) on delete set null,
add column if not exists member_zone_lesson_id uuid references public.member_zone_lessons(id) on delete set null;

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
  'member_zone_purchase'::text
]));
