do $$
declare
  v_studio_id uuid := 'ccccccc1-cccc-cccc-cccc-ccccccccccc1';
  v_location_id uuid := 'ccccccc2-cccc-cccc-cccc-ccccccccccc2';
  v_actor_id uuid := 'ccccccc3-cccc-cccc-cccc-ccccccccccc3';
  v_customer_id uuid := 'ccccccc4-cccc-cccc-cccc-ccccccccccc4';
  v_service_1_id uuid := 'ccccccc5-cccc-cccc-cccc-ccccccccccc5';
  v_service_2_id uuid := 'ccccccc6-cccc-cccc-cccc-ccccccccccc6';
  v_employee_id uuid := 'ccccccc7-cccc-cccc-cccc-ccccccccccc7';

  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_create jsonb;
  v_item_1 jsonb;
  v_item_2 jsonb;
  v_lock jsonb;
  v_complete jsonb;
  v_refund_1 jsonb;
  v_refund_1_replay jsonb;

  v_sale_id uuid;
  v_sale_status text;
  v_sale_refunded_amount numeric(12,2);
  v_payment_status text;
  v_payment_id uuid;

  v_over_refund_blocked boolean := false;
  v_audit_count integer;
begin
  insert into public.users (id, email)
  values (v_actor_id, format('pos04-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_actor_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'POS04 Main Location', true)
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values
    (v_service_1_id, v_studio_id, 'POS04 Service A', 120, 'SGD', true),
    (v_service_2_id, v_studio_id, 'POS04 Service B', 80, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name, employment_status)
  values (v_employee_id, v_studio_id, 'POS04 Employee', 'active')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'POS04 Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  v_create := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'POS-04 verify partial refund',
    p_idempotency_key := format('pos04-create-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-create-%s', v_nonce), 'sha256'), 'hex')
  );

  v_sale_id := (v_create->>'sale_id')::uuid;
  if v_sale_id is null then
    raise exception 'POS-04 verify missing sale_id: %', v_create;
  end if;

  v_item_1 := public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_1_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'POS04 Service A',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 120,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos04-item1-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-item1-%s', v_nonce), 'sha256'), 'hex')
  );

  v_item_2 := public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_item_id := null,
    p_line_number := 2,
    p_item_type := 'service',
    p_service_id := v_service_2_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'POS04 Service B',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 80,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos04-item2-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-item2-%s', v_nonce), 'sha256'), 'hex')
  );

  v_lock := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos04-lock-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-lock-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_lock->>'status', '') <> 'pending_payment' then
    raise exception 'POS-04 verify lock must return pending_payment: %', v_lock;
  end if;

  insert into public.payments (
    studio_id,
    location_id,
    pos_sale_id,
    amount,
    currency,
    payment_method,
    sales_channel,
    source,
    status,
    reference_code,
    type,
    remaining_uses
  ) values (
    v_studio_id,
    v_location_id,
    v_sale_id,
    200,
    'SGD',
    'cash',
    'frontdesk',
    'pos_sale',
    'pending',
    format('POS04-%s', left(v_nonce, 16)),
    'single',
    0
  )
  returning id into v_payment_id;

  v_complete := public.complete_pos_cash_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos04-cash-complete-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-complete-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_complete->>'sale_status', '') <> 'paid' then
    raise exception 'POS-04 verify complete_pos_cash_sale did not mark paid: %', v_complete;
  end if;

  -- Success path: partial refund by amount.
  v_refund_1 := public.refund_pos_sale_items(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_items := jsonb_build_array(jsonb_build_object(
      'item_id', v_item_1->>'item_id',
      'refund_amount', 60
    )),
    p_reason := 'verify partial refund',
    p_idempotency_key := format('pos04-refund-1-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-refund-1-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_refund_1->>'sale_status', '') <> 'partially_refunded' then
    raise exception 'POS-04 verify partial refund should set partially_refunded: %', v_refund_1;
  end if;

  select s.status, s.refunded_amount
    into v_sale_status, v_sale_refunded_amount
  from public.pos_sales s
  where s.id = v_sale_id;

  if v_sale_status <> 'partially_refunded' or v_sale_refunded_amount <> 60 then
    raise exception 'POS-04 verify sale status/refunded mismatch after partial refund: status %, refunded %', v_sale_status, v_sale_refunded_amount;
  end if;

  select p.status
    into v_payment_status
  from public.payments p
  where p.id = v_payment_id;

  if v_payment_status <> 'paid' then
    raise exception 'POS-04 verify payment should remain paid for partial refund, got %', v_payment_status;
  end if;

  -- Idempotency replay: same key/hash returns same outcome and no extra audit row.
  v_refund_1_replay := public.refund_pos_sale_items(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_items := jsonb_build_array(jsonb_build_object(
      'item_id', v_item_1->>'item_id',
      'refund_amount', 60
    )),
    p_reason := 'verify partial refund',
    p_idempotency_key := format('pos04-refund-1-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-refund-1-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_refund_1_replay->>'sale_id')::uuid is distinct from v_sale_id
     or coalesce(v_refund_1_replay->>'sale_status', '') <> 'partially_refunded'
     or coalesce((v_refund_1_replay->>'refunded_amount')::numeric, -1) <> 60
     or coalesce(v_refund_1_replay->>'payment_status', '') <> 'paid' then
    raise exception 'POS-04 verify replay must return first result snapshot: %', v_refund_1_replay;
  end if;

  select count(*)::integer
    into v_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_sale_items_refunded'
    and l.target_id = v_sale_id;

  if v_audit_count <> 1 then
    raise exception 'POS-04 verify replay should not add extra audit rows, got %', v_audit_count;
  end if;

  -- Rejection path: over-refund should fail.
  begin
    perform public.refund_pos_sale_items(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_id,
      p_items := jsonb_build_array(jsonb_build_object(
        'item_id', v_item_1->>'item_id',
        'refund_amount', 200
      )),
      p_reason := 'verify over refund blocked',
      p_idempotency_key := format('pos04-over-refund-%s', v_nonce),
      p_request_hash := encode(digest(format('pos04-over-refund-%s', v_nonce), 'sha256'), 'hex')
    );
  exception
    when others then
      v_over_refund_blocked := true;
  end;

  if not v_over_refund_blocked then
    raise exception 'POS-04 verify expected over-refund rejection but call succeeded';
  end if;
end;
$$;

select 'pos04_partial_refund_ok' as result;
