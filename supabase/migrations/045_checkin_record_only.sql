-- Check-in should be attendance-only.
-- Financial settlement must happen before booking is considered successful:
-- - PayNow booking: payment must be confirmed (booking becomes booked)
-- - Package booking: credits are deducted at booking time
-- This function now only toggles booking attendance state (booked -> attended).

create or replace function public.checkin_booking(
  p_booking_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_session record;
  v_authorized boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_booked');
  end if;

  select
    cs.id as session_id,
    c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id;

  v_authorized := exists (
    select 1 from public.studios s where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_session.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk', 'instructor')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.bookings
    set status = 'attended',
        checked_in_at = now(),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
          jsonb_build_object('checkin_by', p_actor_id::text, 'checkin_at', now())
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.checkin_booking(uuid, uuid) to service_role;
