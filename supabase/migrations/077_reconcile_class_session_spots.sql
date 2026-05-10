-- Recompute spots_left from capacity minus active bookings (pending + booked).
-- Use after manual fixes or if spots_left drifted vs reality.
--
-- Safety: Service role only (run from dashboard SQL / backend).

create or replace function public.reconcile_class_session_spots(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_capacity int;
  v_active   int;
  v_new_spots int;
begin
  select cs.capacity into v_capacity
  from public.class_sessions cs
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  select count(*)::int into v_active
  from public.bookings b
  where b.session_id = p_session_id
    and b.status in ('pending', 'booked');

  v_new_spots := greatest(0, v_capacity - v_active);

  update public.class_sessions
  set spots_left = v_new_spots
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'capacity', v_capacity,
    'active_bookings', v_active,
    'spots_left', v_new_spots
  );
end;
$$;

alter function public.reconcile_class_session_spots(uuid) owner to postgres;

revoke all on function public.reconcile_class_session_spots(uuid) from public;
revoke all on function public.reconcile_class_session_spots(uuid) from anon;
revoke all on function public.reconcile_class_session_spots(uuid) from authenticated;
grant execute on function public.reconcile_class_session_spots(uuid) to service_role;
