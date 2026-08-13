do $$
declare
  v_studio_id uuid := 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_location_id uuid := 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_actor_id uuid := 'bbbbbbb3-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_customer_id uuid := 'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_service_id uuid := 'bbbbbbb5-bbbb-bbbb-bbbb-bbbbbbbbbbb5';
  v_employee_id uuid := 'bbbbbbb6-bbbb-bbbb-bbbb-bbbbbbbbbbb6';
  v_other_studio_id uuid := 'bbbbbbb7-bbbb-bbbb-bbbb-bbbbbbbbbbb7';
  v_other_location_id uuid := 'bbbbbbb8-bbbb-bbbb-bbbb-bbbbbbbbbbb8';
  v_out_of_scope_actor_id uuid := 'bbbbbbb9-bbbb-bbbb-bbbb-bbbbbbbbbbb9';

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
  v_paid_at timestamptz;
  v_verified_at timestamptz;
  v_verified_by uuid;
  v_payment_method text;
  v_receipt_number text;
  v_receipt_number_replay text;

  v_audit_count integer;
  v_audit_count_after_replay integer;
  v_forbidden_hit boolean := false;
begin
  insert into public.users (id, email)
  values (v_actor_id, format('pos02-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.users (id, email)
  values (v_out_of_scope_actor_id, format('pos02-unauth-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_actor_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'POS02 Main Location', true)
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values (v_service_id, v_studio_id, 'POS02 Service', 128, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name, employment_status)
  values (v_employee_id, v_studio_id, 'POS02 Employee', 'active')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'POS02 Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  v_create := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'POS-02 verify cash complete',
    p_idempotency_key := format('pos02-create-%s', v_nonce),
    p_request_hash := encode(digest(format('pos02-create-%s', v_nonce), 'sha256'), 'hex')
  );

  v_sale_id := (v_create->>'sale_id')::uuid;
  if v_sale_id is null then
    raise exception 'POS-02 verify create_pos_sale_draft missing sale_id: %', v_create;
  end if;

  v_item := public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'POS02 Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 128,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos02-item-%s', v_nonce),
    p_request_hash := encode(digest(format('pos02-item-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_item->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'POS-02 verify upsert_pos_sale_item sale mismatch: %', v_item;
  end if;

  v_lock := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos02-lock-%s', v_nonce),
    p_request_hash := encode(digest(format('pos02-lock-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_lock->>'status', '') <> 'pending_payment' then
    raise exception 'POS-02 verify lock must return pending_payment: %', v_lock;
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
    128,
    'SGD',
    'cash',
    'frontdesk',
    'pos_sale',
    'pending',
    format('POS02-%s', left(v_nonce, 16)),
    'single',
    0
  )
  returning id into v_payment_id;

  -- success path
  v_complete_1 := public.complete_pos_cash_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos02-cash-complete-%s', v_nonce),
    p_request_hash := encode(digest(format('pos02-cash-complete-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_complete_1->>'sale_status', '') <> 'paid'
     or coalesce(v_complete_1->>'payment_status', '') <> 'paid' then
    raise exception 'POS-02 verify complete_pos_cash_sale did not return paid statuses: %', v_complete_1;
  end if;

  select s.status, s.paid_at
    into v_sale_status, v_paid_at
  from public.pos_sales s
  where s.id = v_sale_id;

  select s.receipt_number
    into v_receipt_number
  from public.pos_sales s
  where s.id = v_sale_id;

  select p.status, p.verified_at, p.verified_by, p.payment_method
    into v_payment_status, v_verified_at, v_verified_by, v_payment_method
  from public.payments p
  where p.id = v_payment_id;

  if v_sale_status <> 'paid' or v_payment_status <> 'paid' then
    raise exception 'POS-02 verify row status mismatch: sale %, payment %', v_sale_status, v_payment_status;
  end if;

  if v_paid_at is null or v_verified_at is null or v_verified_by is distinct from v_actor_id then
    raise exception 'POS-02 verify paid/verified fields missing: paid_at %, verified_at %, verified_by %',
      v_paid_at, v_verified_at, v_verified_by;
  end if;

  if v_payment_method <> 'cash' then
    raise exception 'POS-02 verify payment_method must be cash, got %', v_payment_method;
  end if;

  if v_receipt_number is null or v_receipt_number = '' then
    raise exception 'POS-02 verify receipt_number is required after cash completion';
  end if;

  select count(*)::integer
    into v_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_sale_completed'
    and l.target_id = v_sale_id;

  if v_audit_count <> 1 then
    raise exception 'POS-02 verify expected exactly one cash-complete audit row, got %', v_audit_count;
  end if;

  -- replay idempotency: same key should not create extra audit row
  v_complete_2 := public.complete_pos_cash_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos02-cash-complete-%s', v_nonce),
    p_request_hash := encode(digest(format('pos02-cash-complete-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_complete_2->>'sale_id')::uuid is distinct from v_sale_id
     or (v_complete_2->>'payment_id')::uuid is distinct from v_payment_id then
    raise exception 'POS-02 verify idempotency replay mismatch: %', v_complete_2;
  end if;

  select s.receipt_number
    into v_receipt_number_replay
  from public.pos_sales s
  where s.id = v_sale_id;

  if v_receipt_number_replay is distinct from v_receipt_number then
    raise exception 'POS-02 verify replay must keep same receipt_number: first %, replay %',
      v_receipt_number, v_receipt_number_replay;
  end if;

  select count(*)::integer
    into v_audit_count_after_replay
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_sale_completed'
    and l.target_id = v_sale_id;

  if v_audit_count_after_replay <> 1 then
    raise exception 'POS-02 verify replay should not add audit rows, got %', v_audit_count_after_replay;
  end if;

  -- forbidden path: actor out of location scope should be denied
  insert into public.locations (id, studio_id, name, is_active)
  values (v_other_location_id, v_studio_id, 'POS02 Other Location', true)
  on conflict (id) do nothing;

  insert into public.staff_memberships (studio_id, user_id, location_id, role, is_active)
  values (v_studio_id, v_out_of_scope_actor_id, v_other_location_id, 'frontdesk', true)
  on conflict do nothing;

  begin
    perform public.complete_pos_cash_sale(
      p_actor_id := v_out_of_scope_actor_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_id,
      p_idempotency_key := format('pos02-forbidden-%s', v_nonce),
      p_request_hash := encode(digest(format('pos02-forbidden-%s', v_nonce), 'sha256'), 'hex')
    );
  exception
    when sqlstate '42501' then
      v_forbidden_hit := true;
  end;

  if not v_forbidden_hit then
    raise exception 'POS-02 verify expected forbidden(42501) for out-of-scope completion';
  end if;
end;
$$;

select 'pos02_cash_complete_ok' as result;
