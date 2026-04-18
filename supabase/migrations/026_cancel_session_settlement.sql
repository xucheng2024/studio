-- Studio-initiated session cancel: bookings -> cancelled_by_studio, credits, paid refunds, session cancelled.

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check check (
    status in (
      'pending',
      'booked',
      'cancelled',
      'attended',
      'no_show',
      'late_cancel',
      'cancelled_by_studio'
    )
  );

alter table public.bookings
  add column if not exists cancelled_by_studio_at timestamptz,
  add column if not exists cancelled_by_studio_reason text;

alter table public.class_sessions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists cancelled_by uuid references auth.users (id) on delete set null;

create or replace function public.cancel_session_with_settlement(
  p_session_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_booking record;
  v_pay record;
  v_reason text;
  v_refund jsonb;
  v_affected int := 0;
  v_credits int := 0;
  v_refunds int := 0;
  v_errors int := 0;
begin
  select cs.*, c.studio_id as class_studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'session_id', p_session_id,
      'affected_bookings', 0,
      'credits_returned_count', 0,
      'payments_refunded_count', 0,
      'already_cancelled_count', 0,
      'errors_count', 0
    );
  end if;

  if v_session.status <> 'scheduled' then
    return jsonb_build_object(
      'ok', false,
      'error', 'session_not_cancellable',
      'session_status', v_session.status
    );
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Session cancelled by studio');

  for v_booking in
    select * from public.bookings
    where session_id = p_session_id
      and status in ('pending', 'booked')
    for update
  loop
    update public.bookings
    set
      status = 'cancelled_by_studio',
      cancelled_by_studio_at = now(),
      cancelled_by_studio_reason = v_reason
    where id = v_booking.id;

    update public.class_sessions
    set spots_left = spots_left + 1
    where id = p_session_id;

    v_affected := v_affected + 1;

    if v_booking.credit_consumed_at is not null then
      if v_booking.client_package_id is not null then
        update public.client_packages
        set credits_left = credits_left + 1
        where id = v_booking.client_package_id;
        v_credits := v_credits + 1;
      elsif v_booking.payment_id is not null then
        update public.payments
        set remaining_uses = coalesce(remaining_uses, 0) + 1
        where id = v_booking.payment_id;
        v_credits := v_credits + 1;
      end if;
    end if;

    for v_pay in
      select id from public.payments
      where booking_id = v_booking.id
        and status = 'paid'
    loop
      v_refund := public.refund_payment_with_invoice_void(
        v_pay.id,
        p_actor_id,
        coalesce(nullif(trim(p_reason), ''), 'session_cancelled')
      );
      if coalesce((v_refund->>'ok')::boolean, false) is not true then
        v_errors := v_errors + 1;
        raise exception 'refund_failed payment %: %', v_pay.id, coalesce(v_refund->>'error', 'unknown');
      end if;
      if coalesce((v_refund->>'already_refunded')::boolean, false) = false then
        v_refunds := v_refunds + 1;
      end if;
    end loop;
  end loop;

  update public.class_sessions
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = v_reason,
    cancelled_by = p_actor_id
  where id = p_session_id;

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_actor_id,
    'staff',
    'session_cancel_settlement',
    'class_session',
    p_session_id,
    jsonb_build_object('status', 'scheduled'),
    jsonb_build_object(
      'status', 'cancelled',
      'affected_bookings', v_affected,
      'credits_returned_count', v_credits,
      'payments_refunded_count', v_refunds,
      'errors_count', v_errors,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'session_id', p_session_id,
    'affected_bookings', v_affected,
    'credits_returned_count', v_credits,
    'payments_refunded_count', v_refunds,
    'already_cancelled_count', 0,
    'errors_count', v_errors
  );
end;
$$;

revoke all on function public.cancel_session_with_settlement(uuid, uuid, text) from public;
grant execute on function public.cancel_session_with_settlement(uuid, uuid, text) to service_role;
