-- QR entry: public studio slug + guest bookings (incremental migration)

alter table public.studios
  add column if not exists public_slug text;

update public.studios
set public_slug = left(
  lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))
    || '-'
    || replace(id::text, '-', ''),
  60
)
where public_slug is null or trim(public_slug) = '';

alter table public.studios
  alter column public_slug set not null;

create unique index if not exists studios_public_slug_lower
  on public.studios (lower(public_slug));

-- Bookings: optional auth user + guest fields
alter table public.bookings
  alter column client_id drop not null;

alter table public.bookings
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text;

alter table public.bookings
  drop constraint if exists bookings_client_or_guest;

alter table public.bookings
  add constraint bookings_client_or_guest check (
    client_id is not null
    or (
      guest_name is not null
      and trim(guest_name) <> ''
      and guest_email is not null
      and trim(guest_email) <> ''
    )
  );

drop index if exists idx_bookings_active_per_session_client;

create unique index if not exists idx_bookings_active_session_client
  on public.bookings (session_id, client_id)
  where status = 'booked' and client_id is not null;

create unique index if not exists idx_bookings_active_session_guest_email
  on public.bookings (session_id, guest_email)
  where status = 'booked' and client_id is null and guest_email is not null;

-- Guest quick book (no credits; capacity only)
create or replace function public.book_session_guest(
  p_session_id uuid,
  p_studio_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.class_sessions%rowtype;
  new_booking_id uuid;
  em text := lower(trim(p_guest_email));
  nm text := trim(p_guest_name);
  ph text := nullif(trim(p_guest_phone), '');
begin
  if em = '' or nm = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_guest');
  end if;

  select cs.*
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
    and c.studio_id = p_studio_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.status = 'booked'
      and b.client_id is null
      and lower(trim(b.guest_email)) = em
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_booked');
  end if;

  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  insert into public.bookings (
    session_id,
    client_id,
    status,
    guest_name,
    guest_email,
    guest_phone
  )
  values (
    p_session_id,
    null,
    'booked',
    nm,
    em,
    ph
  )
  returning id into new_booking_id;

  update public.class_sessions
    set spots_left = spots_left - 1
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'guest');
end;
$$;

grant execute on function public.book_session_guest(uuid, uuid, text, text, text) to service_role;
