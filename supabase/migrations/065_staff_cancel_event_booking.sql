create or replace function public.staff_cancel_event_booking(
  p_event_booking_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  b public.event_bookings%rowtype;
  e public.events%rowtype;
  p public.payments%rowtype;
begin
  select * into b
  from public.event_bookings
  where id = p_event_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_booking_not_found');
  end if;

  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'event_booking_id', b.id);
  end if;

  select * into e
  from public.events
  where id = b.event_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  if b.payment_id is not null then
    select * into p
    from public.payments
    where id = b.payment_id
    for update;

    if found and p.status = 'pending' then
      update public.payments
      set status = 'failed'
      where id = p.id;
    end if;
  end if;

  update public.event_bookings
  set status = 'cancelled'
  where id = b.id;

  update public.events
  set spots_left = spots_left + 1
  where id = e.id;

  return jsonb_build_object(
    'ok', true,
    'event_booking_id', b.id,
    'event_id', b.event_id
  );
end;
$$;

revoke all on function public.staff_cancel_event_booking(uuid, uuid) from public;
revoke all on function public.staff_cancel_event_booking(uuid, uuid) from anon;
revoke all on function public.staff_cancel_event_booking(uuid, uuid) from authenticated;
grant all on function public.staff_cancel_event_booking(uuid, uuid) to service_role;
