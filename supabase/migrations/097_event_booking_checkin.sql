-- Event booking check-in (attended status on event_bookings).

alter table public.event_bookings
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references public.users(id) on delete set null;

alter table public.event_bookings
  drop constraint if exists event_bookings_status_check;

alter table public.event_bookings
  add constraint event_bookings_status_check
  check (status = any (array['pending'::text, 'booked'::text, 'cancelled'::text, 'attended'::text]));

create or replace function public.checkin_event_booking(
  p_event_booking_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  b public.event_bookings%rowtype;
  v_event record;
  v_authorized boolean := false;
begin
  select * into b from public.event_bookings where id = p_event_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_booked');
  end if;

  select e.id, e.studio_id
  into v_event
  from public.events e
  where e.id = b.event_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  v_authorized := exists (
    select 1 from public.studios s where s.id = v_event.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_event.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.event_bookings
  set
    status = 'attended',
    checked_in_at = now(),
    checked_in_by = p_actor_id
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.checkin_event_booking(uuid, uuid) from public;
grant all on function public.checkin_event_booking(uuid, uuid) to service_role;

create or replace function public.uncheckin_event_booking(
  p_event_booking_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  b public.event_bookings%rowtype;
  v_event record;
  v_authorized boolean := false;
begin
  select * into b from public.event_bookings where id = p_event_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'attended' then
    return jsonb_build_object('ok', false, 'error', 'not_attended');
  end if;

  select e.id, e.studio_id
  into v_event
  from public.events e
  where e.id = b.event_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  v_authorized := exists (
    select 1 from public.studios s where s.id = v_event.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_event.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.event_bookings
  set
    status = 'booked',
    checked_in_at = null,
    checked_in_by = null
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.uncheckin_event_booking(uuid, uuid) from public;
grant all on function public.uncheckin_event_booking(uuid, uuid) to service_role;
