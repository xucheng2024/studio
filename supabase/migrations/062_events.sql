-- Events: standalone paid activities (no class template).

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title text not null,
  description text,
  tags text[],
  start_time timestamptz not null,
  end_time timestamptz not null,
  capacity integer not null,
  spots_left integer not null,
  price numeric(12,2) not null,
  currency text not null default 'SGD',
  is_active boolean not null default true,
  share_slug text,
  image_url text,
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_capacity_check check (capacity > 0),
  constraint events_spots_left_check check (spots_left >= 0),
  constraint events_price_check check (price > 0),
  constraint events_end_after_start check (end_time > start_time),
  constraint events_share_slug_format check ((share_slug is null) or (share_slug ~ '^[a-z0-9-]{6,80}$')),
  constraint events_currency_check check (char_length(currency) between 3 and 8)
);

create index if not exists idx_events_studio_start_time_desc
on public.events using btree (studio_id, start_time desc);

create index if not exists idx_events_studio_active_start_time_desc
on public.events using btree (studio_id, is_active, start_time desc);

create table if not exists public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  status text not null default 'pending',
  payment_status text not null default 'pending',
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint event_bookings_status_check check (status = any (array['pending'::text,'booked'::text,'cancelled'::text])),
  constraint event_bookings_payment_status_check check (payment_status = any (array['pending'::text,'paid'::text])),
  constraint event_bookings_client_or_guest check (
    (client_id is not null)
    or (
      guest_name is not null and trim(guest_name) <> ''
      and guest_email is not null and trim(guest_email) <> ''
    )
  )
);

create unique index if not exists uq_event_bookings_event_client_active
on public.event_bookings (event_id, client_id)
where client_id is not null and status in ('pending','booked');

create unique index if not exists uq_event_bookings_event_guest_email_active
on public.event_bookings (event_id, lower(trim(guest_email)))
where guest_email is not null and status in ('pending','booked');

alter table public.payments
add column if not exists event_booking_id uuid references public.event_bookings(id) on delete set null;

-- Payment source: add event_booking as a valid value.
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

  alter table public.payments
  add constraint payments_source_check
  check (source = any (array['walkin'::text, 'online_booking'::text, 'package_buy'::text, 'event_booking'::text]));
end $$;

create or replace function public.create_pending_event_booking(
  p_event_id uuid,
  p_client_id uuid default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_event record;
  v_booking_id uuid;
  v_guest_email text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select e.id, e.studio_id, e.location_id, e.is_active, e.spots_left
  into v_event
  from public.events e
  where e.id = p_event_id
  for update of e;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;
  if coalesce(v_event.is_active, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'event_not_available');
  end if;
  if coalesce(v_event.spots_left, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null and exists (
    select 1
    from public.event_bookings b
    where b.event_id = p_event_id
      and b.client_id = p_client_id
      and b.status in ('pending','booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1
    from public.event_bookings b
    where b.event_id = p_event_id
      and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
      and b.status in ('pending','booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  update public.events
  set spots_left = spots_left - 1
  where id = p_event_id;

  insert into public.event_bookings (
    event_id, location_id, client_id,
    guest_name, guest_email, guest_phone,
    status, payment_status
  ) values (
    p_event_id, v_event.location_id, p_client_id,
    case when p_client_id is null then nullif(trim(p_guest_name), '') else null end,
    case when p_client_id is null then v_guest_email else null end,
    case when p_client_id is null then nullif(trim(coalesce(p_guest_phone, '')), '') else null end,
    'pending', 'pending'
  ) returning id into v_booking_id;

  return jsonb_build_object(
    'ok', true,
    'event_booking_id', v_booking_id,
    'studio_id', v_event.studio_id,
    'location_id', v_event.location_id
  );
end;
$$;

grant all on function public.create_pending_event_booking(uuid, uuid, text, text, text) to anon;
grant all on function public.create_pending_event_booking(uuid, uuid, text, text, text) to authenticated;
grant all on function public.create_pending_event_booking(uuid, uuid, text, text, text) to service_role;

