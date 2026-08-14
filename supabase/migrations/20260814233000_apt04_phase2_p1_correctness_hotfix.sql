-- APT-04 Phase 2 hotfix: idempotency/atomic settlement correctness
-- Fixes:
--   1) Atomic package consume + settlement
--   2) Atomic online sale/payment/settlement fact creation
--   3) Paid settlement advances appointment out of pending and clears expires_at

create or replace function public.client_package_ledger_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE'
     and old.audit_log_id is null
     and new.audit_log_id is not null
     and (to_jsonb(new) - 'audit_log_id') = (to_jsonb(old) - 'audit_log_id') then
    return new;
  end if;

  raise exception 'client_package_ledger_entries is append-only' using errcode = 'P0001';
end;
$$;

create or replace function public.apt04_finalize_package_settlement(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_idempotency_key_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_existing public.salon_appointment_settlements;
  v_consume jsonb;
  v_settlement jsonb;
  v_client_package_id uuid;
  v_consume_ledger_entry_id uuid;
begin
  select * into v_appt
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.salon_appointment_settlements s
  where s.appointment_id = p_appointment_id
  for update;

  if found then
    if v_existing.settlement_mode <> 'package_credit' then
      raise exception 'appointment % already settled as %', p_appointment_id, v_existing.settlement_mode using errcode = '23514';
    end if;

    if v_existing.status <> 'package_consumed' then
      raise exception 'package settlement % is in invalid status %', v_existing.id, v_existing.status using errcode = '23514';
    end if;

    update public.salon_appointments
    set status = case when status = 'pending' then 'confirmed' else status end,
        expires_at = null,
        updated_by = coalesce(p_actor_id, updated_by)
    where id = p_appointment_id;

    return jsonb_build_object(
      'ok', true,
      'already_settled', true,
      'settlement_id', v_existing.id,
      'client_package_id', v_existing.client_package_id,
      'consume_ledger_entry_id', v_existing.consume_ledger_entry_id,
      'appointment_status', (select status from public.salon_appointments where id = p_appointment_id)
    );
  end if;

  v_consume := public.pkg01_apply_appointment_package_consume(
    p_studio_id := p_studio_id,
    p_appointment_id := p_appointment_id,
    p_actor_id := p_actor_id,
    p_actor_role := 'customer',
    p_idempotency_key_id := p_idempotency_key_id,
    p_correlation_id := format('apt04:%s:package_consume', p_appointment_id::text)
  );

  if coalesce((v_consume ->> 'ok')::boolean, false) is not true then
    raise exception 'package consume failed for appointment %', p_appointment_id using errcode = '23514';
  end if;

  v_client_package_id := nullif(v_consume ->> 'client_package_id', '')::uuid;
  v_consume_ledger_entry_id := nullif(v_consume ->> 'ledger_entry_id', '')::uuid;

  if v_client_package_id is null or v_consume_ledger_entry_id is null then
    raise exception 'package consume missing linkage ids for appointment %', p_appointment_id using errcode = '23514';
  end if;

  v_settlement := public.apt04_upsert_appointment_settlement(
    p_actor_id := p_actor_id,
    p_studio_id := p_studio_id,
    p_appointment_id := p_appointment_id,
    p_settlement_mode := 'package_credit',
    p_required_amount := round(coalesce(v_appt.service_price_snapshot, 0)::numeric, 2),
    p_currency := coalesce(v_appt.service_currency_snapshot, 'SGD'),
    p_payment_id := null,
    p_pos_sale_id := null,
    p_client_package_id := v_client_package_id,
    p_consume_ledger_entry_id := v_consume_ledger_entry_id,
    p_expires_at := null,
    p_metadata := jsonb_build_object(
      'eligibility_rule', 'conservative_studio_location_expiry_balance',
      'service_level_mapping', 'not_configured_phase2'
    )
  );

  if coalesce((v_settlement ->> 'ok')::boolean, false) is not true then
    raise exception 'package settlement upsert failed for appointment %', p_appointment_id using errcode = '23514';
  end if;

  update public.salon_appointments
  set status = case when status = 'pending' then 'confirmed' else status end,
      expires_at = null,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = p_appointment_id;

  return jsonb_build_object(
    'ok', true,
    'already_settled', false,
    'settlement_id', v_settlement ->> 'settlement_id',
    'client_package_id', v_client_package_id,
    'consume_ledger_entry_id', v_consume_ledger_entry_id,
    'appointment_status', (select status from public.salon_appointments where id = p_appointment_id)
  );
end;
$$;

create or replace function public.apt04_prepare_online_settlement(
  p_actor_id uuid,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_settlement_mode text,
  p_expires_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_settlement public.salon_appointment_settlements;
  v_existing_payment public.payments;
  v_sale public.pos_sales;
  v_payment public.payments;
  v_expected_amount numeric(12,2);
  v_required_amount numeric(12,2);
  v_currency text;
  v_expires_at timestamptz;
  v_reference_code text;
  v_upsert jsonb;
begin
  if p_settlement_mode not in ('online_deposit', 'online_full') then
    raise exception 'invalid online settlement mode %', p_settlement_mode using errcode = '23514';
  end if;

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
  where s.appointment_id = p_appointment_id
  for update;

  if found then
    if v_settlement.settlement_mode <> p_settlement_mode then
      raise exception 'appointment % already has settlement mode %', p_appointment_id, v_settlement.settlement_mode using errcode = '23514';
    end if;

    if v_settlement.payment_id is null then
      raise exception 'existing settlement % missing payment linkage', v_settlement.id using errcode = '23514';
    end if;

    select * into v_existing_payment
    from public.payments p
    where p.id = v_settlement.payment_id
    for update;

    if not found then
      raise exception 'payment % not found for settlement %', v_settlement.payment_id, v_settlement.id using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'settlement_id', v_settlement.id,
      'settlement_status', v_settlement.status,
      'payment_id', v_existing_payment.id,
      'pos_sale_id', v_settlement.pos_sale_id,
      'required_amount', v_settlement.required_amount,
      'expected_amount', round(coalesce((v_settlement.metadata->>'expected_payment_amount')::numeric, v_settlement.required_amount)::numeric, 2),
      'currency', v_settlement.currency,
      'expires_at', v_settlement.expires_at,
      'checkout_url', v_existing_payment.gateway_checkout_url,
      'reference_code', v_existing_payment.reference_code
    );
  end if;

  v_required_amount := round(greatest(coalesce(v_appt.service_price_snapshot, 0), 0)::numeric, 2);
  v_currency := upper(coalesce(nullif(btrim(v_appt.service_currency_snapshot), ''), 'SGD'));
  if p_settlement_mode = 'online_full' then
    v_expected_amount := v_required_amount;
  else
    if v_required_amount <= 0 then
      v_expected_amount := 0;
    else
      v_expected_amount := greatest(1::numeric, round(v_required_amount * 0.30, 2));
    end if;
  end if;

  v_expires_at := now() + make_interval(mins => greatest(1, least(coalesce(p_expires_minutes, 15), 60)));

  insert into public.pos_sales (
    studio_id,
    location_id,
    salon_customer_id,
    cashier_user_id,
    status,
    currency,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount,
    note,
    locked_at,
    submitted_at,
    created_by,
    updated_by
  ) values (
    p_studio_id,
    v_appt.location_id,
    v_appt.salon_customer_id,
    null,
    'pending_payment',
    v_currency,
    v_expected_amount,
    0,
    0,
    v_expected_amount,
    format('APT-04 self booking %s', p_appointment_id::text),
    now(),
    now(),
    p_actor_id,
    p_actor_id
  )
  returning * into v_sale;

  insert into public.pos_sale_items (
    sale_id,
    studio_id,
    location_id,
    line_number,
    item_type,
    service_id,
    package_id,
    product_id,
    salon_appointment_id,
    employee_id,
    item_name_snapshot,
    item_currency_snapshot,
    quantity,
    unit_price_amount,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount
  ) values (
    v_sale.id,
    p_studio_id,
    v_appt.location_id,
    1,
    'service',
    v_appt.service_id,
    null,
    null,
    p_appointment_id,
    v_appt.employee_id,
    v_appt.service_title_snapshot,
    v_currency,
    1,
    v_expected_amount,
    v_expected_amount,
    0,
    0,
    v_expected_amount
  );

  v_reference_code := format('APT-%s', upper(replace(substr(p_appointment_id::text, 1, 20), '-', '')));

  insert into public.payments (
    studio_id,
    location_id,
    pos_sale_id,
    client_id,
    amount,
    currency,
    payment_method,
    sales_channel,
    source,
    status,
    reference_code,
    type,
    remaining_uses,
    service_id,
    service_title_snapshot,
    expires_at
  ) values (
    p_studio_id,
    v_appt.location_id,
    v_sale.id,
    p_actor_id,
    v_expected_amount,
    v_currency,
    'hitpay',
    'online',
    'pos_sale',
    'pending',
    v_reference_code,
    'single',
    0,
    v_appt.service_id,
    v_appt.service_title_snapshot,
    v_expires_at
  )
  returning * into v_payment;

  v_upsert := public.apt04_upsert_appointment_settlement(
    p_actor_id := p_actor_id,
    p_studio_id := p_studio_id,
    p_appointment_id := p_appointment_id,
    p_settlement_mode := p_settlement_mode,
    p_required_amount := v_required_amount,
    p_currency := v_currency,
    p_payment_id := v_payment.id,
    p_pos_sale_id := v_sale.id,
    p_client_package_id := null,
    p_consume_ledger_entry_id := null,
    p_expires_at := v_expires_at,
    p_metadata := jsonb_build_object(
      'expected_payment_amount', v_expected_amount,
      'eligibility_rule', 'server_price_snapshot'
    )
  );

  if coalesce((v_upsert ->> 'ok')::boolean, false) is not true then
    raise exception 'online settlement upsert failed for appointment %', p_appointment_id using errcode = '23514';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_exists', false,
    'settlement_id', v_upsert ->> 'settlement_id',
    'settlement_status', coalesce(v_upsert ->> 'status', 'pending_payment'),
    'payment_id', v_payment.id,
    'pos_sale_id', v_sale.id,
    'required_amount', v_required_amount,
    'expected_amount', v_expected_amount,
    'currency', v_currency,
    'expires_at', v_expires_at,
    'checkout_url', v_payment.gateway_checkout_url,
    'reference_code', v_reference_code
  );
end;
$$;

create or replace function public.apt04_mark_settlement_paid(
  p_studio_id uuid,
  p_payment_id uuid,
  p_sale_id uuid default null,
  p_actor_role text default 'hitpay_webhook',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_payment public.payments;
  v_sale public.pos_sales;
  v_settlement public.salon_appointment_settlements;
  v_appt public.salon_appointments;
  v_expected_amount numeric(12,2);
  v_target_status text;
begin
  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'payment % not found in studio %', p_payment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_payment.status <> 'paid' then
    raise exception 'payment % is not paid', p_payment_id using errcode = '23514';
  end if;

  if v_payment.source <> 'pos_sale' or v_payment.pos_sale_id is null then
    raise exception 'payment % is not a trusted pos_sale payment source', p_payment_id using errcode = '23514';
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.id = coalesce(p_sale_id, v_payment.pos_sale_id)
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale % not found in studio %', coalesce(p_sale_id, v_payment.pos_sale_id), p_studio_id using errcode = 'P0002';
  end if;

  if v_sale.id <> v_payment.pos_sale_id then
    raise exception 'payment % links to sale %, not %', p_payment_id, v_payment.pos_sale_id, v_sale.id using errcode = '23514';
  end if;

  select * into v_settlement
  from public.salon_appointment_settlements s
  where s.studio_id = p_studio_id
    and s.payment_id = p_payment_id
    and s.pos_sale_id = v_sale.id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'settlement_not_found');
  end if;

  if v_settlement.status in ('payment_failed', 'payment_expired', 'payment_cancelled') then
    raise exception 'terminal settlement % cannot be moved to paid directly', v_settlement.id using errcode = '23514';
  end if;

  if v_settlement.status in ('deposit_paid', 'fully_paid') then
    update public.salon_appointments
    set status = case when status = 'pending' then 'confirmed' else status end,
        expires_at = null,
        updated_by = coalesce(p_actor_id, updated_by)
    where id = v_settlement.appointment_id;
    return jsonb_build_object('ok', true, 'already_paid', true, 'status', v_settlement.status);
  end if;

  select * into v_appt
  from public.salon_appointments a
  where a.id = v_settlement.appointment_id
  for update;

  if not found then
    raise exception 'appointment % missing for settlement %', v_settlement.appointment_id, v_settlement.id using errcode = 'P0002';
  end if;

  if v_appt.studio_id <> p_studio_id
     or v_appt.location_id <> v_settlement.location_id
     or v_appt.salon_customer_id <> v_settlement.salon_customer_id then
    raise exception 'payment->sale->settlement->appointment chain mismatch' using errcode = '23514';
  end if;

  v_expected_amount := round(coalesce((v_settlement.metadata->>'expected_payment_amount')::numeric, v_settlement.required_amount)::numeric, 2);
  if round(coalesce(v_payment.amount, 0)::numeric, 2) <> v_expected_amount then
    raise exception 'paid amount mismatch: payment %, expected %', v_payment.amount, v_expected_amount using errcode = '23514';
  end if;

  if v_settlement.settlement_mode = 'online_deposit' then
    v_target_status := 'deposit_paid';
  else
    v_target_status := 'fully_paid';
  end if;

  update public.salon_appointment_settlements
  set status = v_target_status,
      paid_amount = v_expected_amount,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = v_settlement.id;

  update public.salon_appointments
  set status = case when status = 'pending' then 'confirmed' else status end,
      expires_at = null,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = v_settlement.appointment_id;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_settlement_mark_paid',
    p_target_type := 'salon_appointment_settlement',
    p_actor_type := 'system',
    p_location_id := v_settlement.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_settlement.id,
    p_before_state := to_jsonb(v_settlement),
    p_after_state := jsonb_build_object(
      'status', v_target_status,
      'paid_amount', v_expected_amount,
      'payment_id', p_payment_id,
      'pos_sale_id', v_sale.id,
      'appointment_status', (select status from public.salon_appointments where id = v_settlement.appointment_id)
    )
  );

  return jsonb_build_object('ok', true, 'already_paid', false, 'status', v_target_status);
end;
$$;

revoke all on function public.apt04_finalize_package_settlement(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.apt04_prepare_online_settlement(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.apt04_finalize_package_settlement(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.apt04_prepare_online_settlement(uuid, uuid, uuid, text, integer)
  to service_role;
