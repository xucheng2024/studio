-- POS-03 Batch 1: complete pending POS sale with HitPay webhook confirmation.
-- Scope:
--   * transactional update: pos_sales.pending_payment -> paid
--   * transactional update: payments.pending -> paid (hitpay)
--   * idempotent replay-safe completion + strong audit trail

create or replace function public.complete_pos_hitpay_sale(
  p_studio_id uuid,
  p_payment_id uuid default null,
  p_sale_id uuid default null,
  p_provider_event_id uuid default null,
  p_gateway_payment_id text default null,
  p_gateway_status text default null,
  p_gateway_payload text default null,
  p_verified_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_sale_before public.pos_sales;
  v_sale_after public.pos_sales;
  v_payment_before public.payments;
  v_payment_after public.payments;
  v_owner_id uuid;
begin
  if p_payment_id is null and p_sale_id is null then
    raise exception 'p_payment_id or p_sale_id is required' using errcode = '22023';
  end if;

  if p_payment_id is not null then
    select *
      into v_payment_before
    from public.payments p
    where p.id = p_payment_id
      and p.studio_id = p_studio_id
    for update;
  else
    select *
      into v_payment_before
    from public.payments p
    where p.studio_id = p_studio_id
      and p.pos_sale_id = p_sale_id
    for update;
  end if;

  if not found then
    raise exception 'POS payment not found in studio % (payment %, sale %)', p_studio_id, p_payment_id, p_sale_id
      using errcode = 'P0002';
  end if;

  if v_payment_before.pos_sale_id is null then
    raise exception 'payment % is not linked to a POS sale', v_payment_before.id using errcode = '23514';
  end if;

  if p_sale_id is not null and v_payment_before.pos_sale_id <> p_sale_id then
    raise exception 'payment % is linked to sale %, not %', v_payment_before.id, v_payment_before.pos_sale_id, p_sale_id
      using errcode = '23514';
  end if;

  select *
    into v_sale_before
  from public.pos_sales s
  where s.id = v_payment_before.pos_sale_id
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'POS sale % not found for payment %', v_payment_before.pos_sale_id, v_payment_before.id using errcode = 'P0002';
  end if;

  if v_payment_before.source <> 'pos_sale' then
    raise exception 'payment % source % is not pos_sale', v_payment_before.id, v_payment_before.source using errcode = '23514';
  end if;

  if v_sale_before.status <> 'pending_payment' and v_sale_before.status <> 'paid' then
    raise exception 'sale % status % cannot complete HitPay sale', v_sale_before.id, v_sale_before.status using errcode = '23514';
  end if;

  if v_payment_before.status <> 'pending' and v_payment_before.status <> 'paid' then
    raise exception 'payment % status % cannot complete HitPay sale', v_payment_before.id, v_payment_before.status using errcode = '23514';
  end if;

  if p_verified_by is not null then
    v_owner_id := p_verified_by;
  else
    select s.owner_id
      into v_owner_id
    from public.studios s
    where s.id = p_studio_id;
  end if;

  if v_sale_before.status = 'paid' and v_payment_before.status = 'paid' then
    select *
      into v_payment_after
    from public.payments p
    where p.id = v_payment_before.id;

    return jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_before.id,
      'payment_id', v_payment_before.id,
      'sale_status', v_sale_before.status,
      'payment_status', v_payment_before.status,
      'paid_at', v_sale_before.paid_at,
      'verified_at', v_payment_before.verified_at,
      'verified_by', v_payment_before.verified_by,
      'payment_method', v_payment_before.payment_method,
      'receipt_number', v_sale_before.receipt_number,
      'already_paid', true,
      'already_completed', false
    );
  end if;

  update public.payments
  set status = 'paid',
      payment_method = 'hitpay',
      paid_at = coalesce(v_payment_before.paid_at, v_now),
      verified_at = coalesce(v_payment_before.verified_at, v_now),
      verified_by = coalesce(v_payment_before.verified_by, v_owner_id)
  where id = v_payment_before.id
  returning * into v_payment_after;

  update public.pos_sales
  set status = 'paid',
      paid_at = coalesce(v_sale_before.paid_at, v_now),
      receipt_number = coalesce(v_sale_before.receipt_number, public.pos_generate_receipt_number(v_now)),
      updated_by = coalesce(v_sale_before.updated_by, v_owner_id)
  where id = v_sale_before.id
  returning * into v_sale_after;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pos_hitpay_sale_completed',
    p_target_type := 'pos_sale',
    p_actor_type := 'system',
    p_location_id := v_sale_before.location_id,
    p_actor_id := v_owner_id,
    p_actor_role := 'hitpay_webhook',
    p_target_id := v_sale_before.id,
    p_before_state := jsonb_build_object(
      'sale', to_jsonb(v_sale_before),
      'payment', to_jsonb(v_payment_before)
    ),
    p_after_state := jsonb_build_object(
      'sale', to_jsonb(v_sale_after),
      'payment', to_jsonb(v_payment_after),
      'from_status', v_sale_before.status,
      'to_status', v_sale_after.status,
      'payment_from_status', v_payment_before.status,
        'payment_to_status', v_payment_after.status,
        'payment_method', v_payment_after.payment_method,
        'receipt_number', v_sale_after.receipt_number,
        'provider_payment_id', nullif(btrim(coalesce(p_gateway_payment_id, '')), ''),
        'provider_status', nullif(btrim(coalesce(p_gateway_status, '')), ''),
        'gateway_payload_present', (p_gateway_payload is not null)
      ),
    p_provider_event_id := p_provider_event_id
  );

  return jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_after.id,
    'payment_id', v_payment_after.id,
    'sale_status', v_sale_after.status,
    'payment_status', v_payment_after.status,
    'paid_at', v_sale_after.paid_at,
    'verified_at', v_payment_after.verified_at,
    'verified_by', v_payment_after.verified_by,
    'payment_method', v_payment_after.payment_method,
    'receipt_number', v_sale_after.receipt_number,
    'already_paid', false,
    'already_completed', false
  );
end;
$$;

revoke all on function public.complete_pos_hitpay_sale(uuid, uuid, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.complete_pos_hitpay_sale(uuid, uuid, uuid, uuid, text, text, text, uuid)
  to service_role;
