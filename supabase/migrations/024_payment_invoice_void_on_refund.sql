-- Invoice lifecycle: issued | void; auto-void on refund when an invoice number exists.

alter table public.payments
  add column if not exists invoice_status text;

update public.payments
set invoice_status = 'issued'
where invoice_status is null;

alter table public.payments
  alter column invoice_status set default 'issued';

alter table public.payments
  alter column invoice_status set not null;

alter table public.payments
  drop constraint if exists payments_invoice_status_check;

alter table public.payments
  add constraint payments_invoice_status_check
  check (invoice_status in ('issued', 'void'));

alter table public.payments
  add column if not exists invoice_voided_at timestamptz;

alter table public.payments
  add column if not exists invoice_void_reason text;

-- Historical: refunded payments that had an invoice number are treated as voided.
update public.payments
set
  invoice_status = 'void',
  invoice_voided_at = coalesce(invoice_voided_at, verified_at, invoice_sent_at, created_at, now()),
  invoice_void_reason = coalesce(invoice_void_reason, 'payment_refunded')
where status = 'refunded'
  and invoice_number is not null
  and invoice_status = 'issued';

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
      'idempotent', true,
      'status', v_payment.status,
      'invoice_status', v_payment.invoice_status,
      'invoice_number', v_payment.invoice_number,
      'invoice_voided_at', v_payment.invoice_voided_at,
      'invoice_void_reason', v_payment.invoice_void_reason
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
    'idempotent', false,
    'invoice_void_applied', v_void_applied,
    'invoice_number', v_payment.invoice_number
  );
end;
$$;

revoke all on function public.refund_payment_with_invoice_void(uuid, uuid, text) from public;
grant execute on function public.refund_payment_with_invoice_void(uuid, uuid, text) to service_role;
