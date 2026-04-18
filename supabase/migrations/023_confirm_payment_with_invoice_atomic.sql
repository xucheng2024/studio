-- Atomic confirm flow: payment confirmation + invoice assignment + verifier stamp

create or replace function public.confirm_paynow_payment_with_invoice(
  p_payment_id uuid,
  p_verified_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirm jsonb;
  v_ok boolean;
  v_error text;
  v_invoice text;
begin
  v_confirm := public.confirm_paynow_payment(p_payment_id);
  v_ok := coalesce((v_confirm ->> 'ok')::boolean, false);
  if not v_ok then
    v_error := coalesce(v_confirm ->> 'error', 'confirm_failed');
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  select public.assign_payment_invoice_number(p_payment_id) into v_invoice;
  if v_invoice is null or btrim(v_invoice) = '' then
    return jsonb_build_object('ok', false, 'error', 'invoice_assign_failed');
  end if;

  update public.payments
  set verified_at = now(),
      verified_by = p_verified_by
  where id = p_payment_id;

  return jsonb_build_object(
    'ok', true,
    'invoice_number', v_invoice,
    'already_paid', coalesce((v_confirm ->> 'already_paid')::boolean, false),
    'booking_id', v_confirm ->> 'booking_id',
    'client_package_id', v_confirm ->> 'client_package_id'
  );
end;
$$;

revoke all on function public.confirm_paynow_payment_with_invoice(uuid, uuid) from public;
grant execute on function public.confirm_paynow_payment_with_invoice(uuid, uuid) to service_role;

