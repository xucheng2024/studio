-- APT04: pay-at-store self bookings must be confirmed immediately.
-- Previously the `free` settlement left the appointment `pending` with a
-- 15-minute expiry, so the pending sweep cancelled it as `pending_expired`.

create or replace function public.apt04_confirm_free_settlement(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_after public.salon_appointments;
  v_settlement public.salon_appointment_settlements;
begin
  select * into v_appt
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  select * into v_settlement
  from public.salon_appointment_settlements s
  where s.appointment_id = p_appointment_id;

  if not found or v_settlement.settlement_mode <> 'free' or v_settlement.status <> 'no_payment_required' then
    raise exception 'appointment % has no pay-at-store settlement', p_appointment_id using errcode = '23514';
  end if;

  if v_appt.status <> 'pending' then
    return jsonb_build_object('ok', true, 'already_confirmed', true, 'appointment_status', v_appt.status);
  end if;

  update public.salon_appointments
  set status = 'confirmed',
      expires_at = null,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = p_appointment_id
  returning * into v_after;

  insert into public.salon_appointment_status_history (
    appointment_id, studio_id, from_status, to_status, actor, actor_id, actor_role, reason
  )
  values (
    v_appt.id, v_appt.studio_id, 'pending', 'confirmed', 'user', p_actor_id, 'customer', 'pay_at_store_confirmed'
  );

  perform public.record_strong_audit(
    p_studio_id := v_appt.studio_id,
    p_action := 'apt04_pay_at_store_confirmed',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_appt.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := 'customer',
    p_target_id := v_appt.id,
    p_before_state := to_jsonb(v_appt),
    p_after_state := to_jsonb(v_after)
  );

  return jsonb_build_object('ok', true, 'already_confirmed', false, 'appointment_status', v_after.status);
end;
$$;

revoke all on function public.apt04_confirm_free_settlement(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apt04_confirm_free_settlement(uuid, uuid, uuid)
  to service_role;

-- Backfill: pay-at-store bookings that are still pending and not yet expired.
with confirmed as (
  update public.salon_appointments a
  set status = 'confirmed',
      expires_at = null
  from public.salon_appointment_settlements s
  where s.appointment_id = a.id
    and s.settlement_mode = 'free'
    and s.status = 'no_payment_required'
    and a.status = 'pending'
    and a.expires_at > now()
  returning a.id, a.studio_id
)
insert into public.salon_appointment_status_history (
  appointment_id, studio_id, from_status, to_status, actor, actor_id, actor_role, reason
)
select id, studio_id, 'pending', 'confirmed', 'system', null, 'system', 'pay_at_store_confirmed_backfill'
from confirmed;
