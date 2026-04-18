-- Complement 024: invoice listing index + RPC returns full refund/invoice payload for API clients.
-- Studio+status+created_at is already covered by idx_payments_studio_status_created_desc (015).

create index if not exists idx_payments_studio_invoice_status_created_at
  on public.payments (studio_id, invoice_status, created_at desc);

create or replace function public.refund_payment_with_invoice_void(
  p_payment_id uuid,
  p_operator_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_void_applied boolean := false;
  v_reason text;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if v_payment.status = 'refunded' then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_payment.status,
      'invoice_status', v_payment.invoice_status,
      'invoice_number', v_payment.invoice_number,
      'invoice_voided_at', v_payment.invoice_voided_at,
      'invoice_void_reason', v_payment.invoice_void_reason,
      'invoice_void_applied', v_payment.invoice_number is not null and v_payment.invoice_status = 'void'
    );
  end if;

  if v_payment.status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_paid');
  end if;

  v_before := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number
  );

  v_reason := case
    when p_reason is not null and length(trim(p_reason)) > 0 then trim(p_reason)
    else 'payment_refunded'
  end;

  if v_payment.invoice_number is not null then
    update public.payments
    set
      status = 'refunded',
      invoice_status = 'void',
      invoice_voided_at = now(),
      invoice_void_reason = v_reason
    where id = p_payment_id;
    v_void_applied := true;
  else
    update public.payments
    set status = 'refunded'
    where id = p_payment_id;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;

  v_after := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason
  );

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_operator_id,
    'staff',
    'payment_refund_invoice_void',
    'payment',
    p_payment_id,
    v_before,
    v_after
  );

  return jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason,
    'invoice_void_applied', v_void_applied
  );
end;
$$;

revoke all on function public.refund_payment_with_invoice_void(uuid, uuid, text) from public;
grant execute on function public.refund_payment_with_invoice_void(uuid, uuid, text) to service_role;
