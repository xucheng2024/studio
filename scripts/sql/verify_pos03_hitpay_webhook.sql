do $$
declare
  v_studio_id uuid := 'ccccccc1-cccc-cccc-cccc-ccccccccccc1';
  v_location_id uuid := 'ccccccc2-cccc-cccc-cccc-ccccccccccc2';
  v_owner_id uuid := 'ccccccc3-cccc-cccc-cccc-ccccccccccc3';
  v_customer_id uuid := 'ccccccc4-cccc-cccc-cccc-ccccccccccc4';
  v_service_id uuid := 'ccccccc5-cccc-cccc-cccc-ccccccccccc5';
  v_employee_id uuid := 'ccccccc6-cccc-cccc-cccc-ccccccccccc6';

  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_create jsonb;
  v_item jsonb;
  v_lock jsonb;
  v_complete_1 jsonb;
  v_complete_2 jsonb;

  v_sale_id uuid;
  v_payment_id uuid;
  v_sale_status text;
  v_payment_status text;
  v_payment_method text;
  v_paid_at timestamptz;
  v_verified_at timestamptz;
  v_verified_by uuid;
  v_receipt_number text;
  v_gateway_status text;
  v_gateway_payload text;
  v_gateway_refund_payment_id text;
  v_audit_count integer;
  v_audit_count_after_replay integer;
begin
  insert into public.users (id, email)
  values (v_owner_id, format('pos03-owner-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'POS03 Main Location', true)
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values (v_service_id, v_studio_id, 'POS03 Service', 98, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name, employment_status)
  values (v_employee_id, v_studio_id, 'POS03 Employee', 'active')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'POS03 Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  v_create := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'POS-03 verify hitpay webhook complete',
    p_idempotency_key := format('pos03-create-%s', v_nonce),
    p_request_hash := encode(digest(format('pos03-create-%s', v_nonce), 'sha256'), 'hex')
  );

  v_sale_id := (v_create->>'sale_id')::uuid;
  if v_sale_id is null then
    raise exception 'POS-03 verify create_pos_sale_draft missing sale_id: %', v_create;
  end if;

  v_item := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'POS03 Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 98,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos03-item-%s', v_nonce),
    p_request_hash := encode(digest(format('pos03-item-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_item->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'POS-03 verify upsert_pos_sale_item sale mismatch: %', v_item;
  end if;

  v_lock := public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos03-lock-%s', v_nonce),
    p_request_hash := encode(digest(format('pos03-lock-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_lock->>'status', '') <> 'pending_payment' then
    raise exception 'POS-03 verify lock must return pending_payment: %', v_lock;
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
  )
  values (
    v_studio_id,
    v_location_id,
    v_sale_id,
    98,
    'SGD',
    'cash',
    'frontdesk',
    'pos_sale',
    'pending',
    format('POS03-%s', left(v_nonce, 12)),
    'single',
    0
  )
  returning id into v_payment_id;

  v_complete_1 := public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := null,
    p_provider_event_id := null,
    p_gateway_payment_id := format('hp-chg-%s', left(v_nonce, 10)),
    p_gateway_status := 'completed',
    p_gateway_payload := '{event:payment_request.paid}',
    p_verified_by := null
  );

  if coalesce(v_complete_1->>'sale_status', '') <> 'paid'
     or coalesce(v_complete_1->>'payment_status', '') <> 'paid'
     or coalesce(v_complete_1->>'payment_method', '') <> 'hitpay' then
    raise exception 'POS-03 verify first completion result unexpected: %', v_complete_1;
  end if;

  select s.status, s.paid_at, s.receipt_number
    into v_sale_status, v_paid_at, v_receipt_number
  from public.pos_sales s
  where s.id = v_sale_id;

  select p.status, p.payment_method, p.verified_at, p.verified_by,
         p.gateway_status, p.gateway_payload, p.gateway_refund_payment_id
    into v_payment_status, v_payment_method, v_verified_at, v_verified_by,
         v_gateway_status, v_gateway_payload, v_gateway_refund_payment_id
  from public.payments p
  where p.id = v_payment_id;

  if v_sale_status <> 'paid' or v_payment_status <> 'paid' then
    raise exception 'POS-03 verify row status mismatch: sale %, payment %', v_sale_status, v_payment_status;
  end if;

  if v_paid_at is null or v_verified_at is null then
    raise exception 'POS-03 verify paid/verified timestamps required: paid_at %, verified_at %', v_paid_at, v_verified_at;
  end if;

  if v_payment_method <> 'hitpay' then
    raise exception 'POS-03 verify payment_method should be hitpay, got %', v_payment_method;
  end if;

  if v_gateway_status <> 'completed'
     or v_gateway_payload <> '{event:payment_request.paid}'
     or v_gateway_refund_payment_id <> format('hp-chg-%s', left(v_nonce, 10)) then
    raise exception 'POS-03 verify gateway evidence was not persisted atomically: %, %, %',
      v_gateway_status, v_gateway_payload, v_gateway_refund_payment_id;
  end if;

  if v_receipt_number is null then
    raise exception 'POS-03 verify receipt_number is required after HitPay completion';
  end if;

  select count(*)::integer
    into v_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_hitpay_sale_completed'
    and l.target_id = v_sale_id;

  if v_audit_count <> 1 then
    raise exception 'POS-03 verify expected exactly one hitpay-complete audit row, got %', v_audit_count;
  end if;

  v_complete_2 := public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := null,
    p_sale_id := v_sale_id,
    p_provider_event_id := null,
    p_gateway_payment_id := format('hp-chg-%s', left(v_nonce, 10)),
    p_gateway_status := 'completed',
    p_gateway_payload := '{event:payment_request.paid}',
    p_verified_by := null
  );

  if coalesce((v_complete_2->>'already_paid')::boolean, false) is not true then
    raise exception 'POS-03 verify replay must be already_paid: %', v_complete_2;
  end if;

  if (v_complete_2->>'sale_id')::uuid is distinct from v_sale_id
     or (v_complete_2->>'payment_id')::uuid is distinct from v_payment_id then
    raise exception 'POS-03 verify replay id mismatch: %', v_complete_2;
  end if;

  select p.gateway_status, p.gateway_payload, p.gateway_refund_payment_id
    into v_gateway_status, v_gateway_payload, v_gateway_refund_payment_id
  from public.payments p
  where p.id = v_payment_id;

  if v_gateway_status <> 'completed'
     or v_gateway_payload <> '{event:payment_request.paid}'
     or v_gateway_refund_payment_id <> format('hp-chg-%s', left(v_nonce, 10)) then
    raise exception 'POS-03 verify paid replay must not overwrite gateway evidence';
  end if;

  select count(*)::integer
    into v_audit_count_after_replay
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_hitpay_sale_completed'
    and l.target_id = v_sale_id;

  if v_audit_count_after_replay <> 1 then
    raise exception 'POS-03 verify replay should not add audit rows, got %', v_audit_count_after_replay;
  end if;
end;
$$;

do $$
declare
  v_rls boolean;
begin
  select c.relrowsecurity
    into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'hitpay_webhook_failures';

  if v_rls is not true then
    raise exception 'POS-03 webhook failure table must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.hitpay_webhook_failures', 'select')
     or has_table_privilege('authenticated', 'public.hitpay_webhook_failures', 'insert') then
    raise exception 'POS-03 webhook failure table must not be accessible to anon/authenticated';
  end if;

  if not has_table_privilege('service_role', 'public.hitpay_webhook_failures', 'select,insert') then
    raise exception 'POS-03 webhook failure table must be writable by service_role';
  end if;
end;
$$;

select 'pos03_hitpay_webhook_complete_ok' as result;
