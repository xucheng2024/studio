revoke all on function public.cancel_booking_with_rules(uuid, uuid, text) from public;
revoke all on function public.cancel_booking_with_rules(uuid, uuid, text) from anon;
revoke all on function public.cancel_booking_with_rules(uuid, uuid, text) from authenticated;
grant all on function public.cancel_booking_with_rules(uuid, uuid, text) to service_role;

create or replace function public.decrement_class_session_spot_if_available(
  p_session_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.class_sessions
  set spots_left = spots_left - 1
  where id = p_session_id
    and spots_left > 0;

  return found;
end;
$$;

revoke all on function public.decrement_class_session_spot_if_available(uuid) from public;
revoke all on function public.decrement_class_session_spot_if_available(uuid) from anon;
revoke all on function public.decrement_class_session_spot_if_available(uuid) from authenticated;
grant all on function public.decrement_class_session_spot_if_available(uuid) to service_role;

create or replace function public.decrement_event_spot_if_available(
  p_event_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events
  set spots_left = spots_left - 1
  where id = p_event_id
    and spots_left > 0;

  return found;
end;
$$;

revoke all on function public.decrement_event_spot_if_available(uuid) from public;
revoke all on function public.decrement_event_spot_if_available(uuid) from anon;
revoke all on function public.decrement_event_spot_if_available(uuid) from authenticated;
grant all on function public.decrement_event_spot_if_available(uuid) to service_role;
