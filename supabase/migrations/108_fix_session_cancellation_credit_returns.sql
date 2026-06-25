create or replace function public.cancel_booking_with_rules(
  p_booking_id uuid,
  p_actor_id uuid,
  p_cancel_reason text default 'user_cancel'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b              public.bookings%rowtype;
  v_session      record;
  v_rule         record;
  v_is_client    boolean := false;
  v_is_staff     boolean := false;
  v_is_after_cutoff boolean := false;
  v_return_credit boolean := false;
  v_next_status  text;
  v_credits_to_return int := 0;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select cs.id as session_id, cs.start_time, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  v_is_client := b.client_id is not null and b.client_id = p_actor_id;
  v_is_staff  := exists (
    select 1 from public.studios s
    where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1 from public.staff_memberships sm
    where sm.user_id    = p_actor_id
      and sm.studio_id  = v_session.studio_id
      and sm.is_active  = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not (v_is_client or v_is_staff) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if b.status not in ('pending', 'booked') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  select br.cancel_cutoff_hours, br.late_cancel_deduct_credit
  into v_rule
  from public.booking_rules br
  where br.studio_id = v_session.studio_id
    and (br.location_id = b.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  if b.status = 'pending' then
    update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
        credit_policy_applied = jsonb_build_object(
          'policy', 'pending_unpaid_cancel', 'credit_returned', false
        )
    where id = b.id;
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'credit_returned', false);
  end if;

  v_is_after_cutoff := now() >= (
    v_session.start_time - make_interval(hours => coalesce(v_rule.cancel_cutoff_hours, 12))
  );
  v_next_status := case when v_is_after_cutoff then 'late_cancel' else 'cancelled' end;
  v_return_credit := case
    when not v_is_after_cutoff then true
    when coalesce(v_rule.late_cancel_deduct_credit, true) then false
    else true
  end;

  if v_next_status = 'cancelled' then
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
  end if;

  if v_return_credit and b.client_package_id is not null then
    v_credits_to_return := greatest(coalesce(b.credits_consumed, 0), 1);
    update public.client_packages
    set credits_left = credits_left + v_credits_to_return
    where id = b.client_package_id;
  end if;
  if v_return_credit and b.payment_id is not null then
    v_credits_to_return := greatest(coalesce(b.credits_consumed, 0), 1);
    update public.payments
    set remaining_uses = coalesce(remaining_uses, 0) + v_credits_to_return
    where id = b.payment_id;
  end if;

  update public.bookings
  set status = v_next_status,
      cancelled_at = now(),
      cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
      credit_policy_applied = jsonb_build_object(
        'policy', case when v_next_status = 'late_cancel' then 'late_cancel' else 'normal_cancel' end,
        'cutoff_hours', coalesce(v_rule.cancel_cutoff_hours, 12),
        'after_cutoff', v_is_after_cutoff,
        'credit_returned', v_return_credit,
        'credits_returned', case when v_return_credit then v_credits_to_return else 0 end
      )
  where id = b.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_next_status,
    'credit_returned', v_return_credit
  );
end;
$$;
