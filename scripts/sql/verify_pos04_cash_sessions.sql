do $$
declare
  v_studio_id uuid := 'ddddddd1-dddd-dddd-dddd-ddddddddddd1';
  v_location_id uuid := 'ddddddd2-dddd-dddd-dddd-ddddddddddd2';
  v_actor_id uuid := 'ddddddd3-dddd-dddd-dddd-ddddddddddd3';
  v_customer_id uuid := 'ddddddd4-dddd-dddd-dddd-ddddddddddd4';
  v_service_id uuid := 'ddddddd5-dddd-dddd-dddd-ddddddddddd5';
  v_employee_id uuid := 'ddddddd6-dddd-dddd-dddd-ddddddddddd6';

  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_create jsonb;
  v_item jsonb;
  v_lock jsonb;
  v_open_1 jsonb;
  v_open_2 jsonb;
  v_complete_1 jsonb;
  v_complete_2 jsonb;
  v_close_1 jsonb;
  v_close_2 jsonb;

  v_sale_id uuid;
  v_payment_id uuid;
  v_session_id uuid;

  v_no_open_session_blocked boolean := false;
  v_duplicate_open_blocked boolean := false;

  v_payment_cash_session_id uuid;
  v_payment_status text;
  v_sale_status text;

  v_session_status text;
  v_session_opening_float numeric(12,2);
  v_session_cash_in numeric(12,2);
  v_session_cash_out numeric(12,2);
  v_session_expected_cash numeric(12,2);
  v_session_counted_cash numeric(12,2);
  v_session_cash_over_short numeric(12,2);

  v_open_audit_count integer;
  v_open_audit_count_after_replay integer;
  v_complete_audit_count integer;
  v_complete_audit_count_after_replay integer;
  v_close_audit_count integer;
  v_close_audit_count_after_replay integer;
begin
  insert into public.users (id, email)
  values (v_actor_id, format('pos04-cash-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_actor_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'POS04 Cash Session Location', true)
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values (v_service_id, v_studio_id, 'POS04 Cash Session Service', 90, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name, employment_status)
  values (v_employee_id, v_studio_id, 'POS04 Cashier', 'active')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'POS04 Session Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  v_create := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'POS-04 verify cash session lifecycle',
    p_idempotency_key := format('pos04-cash-create-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-create-%s', v_nonce), 'sha256'), 'hex')
  );

  v_sale_id := (v_create->>'sale_id')::uuid;
  if v_sale_id is null then
    raise exception 'POS-04 cash-session verify missing sale_id: %', v_create;
  end if;

  v_item := public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'POS04 Cash Session Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 90,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos04-cash-item-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-item-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_item->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'POS-04 cash-session verify item sale mismatch: %', v_item;
  end if;

  v_lock := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos04-cash-lock-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-lock-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_lock->>'status', '') <> 'pending_payment' then
    raise exception 'POS-04 cash-session verify lock must be pending_payment: %', v_lock;
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
    90,
    'SGD',
    'cash',
    'frontdesk',
    'pos_sale',
    'pending',
    format('POS04-CS-%s', left(v_nonce, 14)),
    'single',
    0
  )
  returning id into v_payment_id;

  -- scenario 1: without an open session, cash completion must be blocked
  begin
    perform public.complete_pos_cash_sale(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_id,
      p_idempotency_key := format('pos04-cash-complete-blocked-%s', v_nonce),
      p_request_hash := encode(digest(format('pos04-cash-complete-blocked-%s', v_nonce), 'sha256'), 'hex')
    );
  exception
    when sqlstate '23514' then
      v_no_open_session_blocked := true;
  end;

  if not v_no_open_session_blocked then
    raise exception 'POS-04 cash-session verify expected no-open-session block for cash completion';
  end if;

  -- scenario 2: open session success
  v_open_1 := public.open_pos_cash_session(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_opening_float := 50,
    p_notes := 'POS-04 opening session verify',
    p_idempotency_key := format('pos04-cash-open-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-open-%s', v_nonce), 'sha256'), 'hex')
  );

  v_session_id := (v_open_1->>'session_id')::uuid;
  if v_session_id is null or coalesce(v_open_1->>'status', '') <> 'open' then
    raise exception 'POS-04 cash-session verify open result invalid: %', v_open_1;
  end if;

  select count(*)::integer
    into v_open_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_session_opened'
    and l.target_id = v_session_id;

  if v_open_audit_count <> 1 then
    raise exception 'POS-04 cash-session verify expected one open audit row, got %', v_open_audit_count;
  end if;

  -- scenario 3: idempotency replay for open session
  v_open_2 := public.open_pos_cash_session(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_opening_float := 50,
    p_notes := 'POS-04 opening session verify',
    p_idempotency_key := format('pos04-cash-open-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-open-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_open_2->>'session_id')::uuid is distinct from v_session_id
     or coalesce(v_open_2->>'status', '') <> 'open' then
    raise exception 'POS-04 cash-session verify open replay mismatch: %', v_open_2;
  end if;

  select count(*)::integer
    into v_open_audit_count_after_replay
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_session_opened'
    and l.target_id = v_session_id;

  if v_open_audit_count_after_replay <> 1 then
    raise exception 'POS-04 cash-session verify open replay should not add audit rows, got %', v_open_audit_count_after_replay;
  end if;

  -- scenario 4: duplicate open with new idempotency key must be rejected
  begin
    perform public.open_pos_cash_session(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_location_id := v_location_id,
      p_opening_float := 20,
      p_notes := 'POS-04 duplicate open should fail',
      p_idempotency_key := format('pos04-cash-open-duplicate-%s', v_nonce),
      p_request_hash := encode(digest(format('pos04-cash-open-duplicate-%s', v_nonce), 'sha256'), 'hex')
    );
  exception
    when sqlstate '23514' then
      v_duplicate_open_blocked := true;
  end;

  if not v_duplicate_open_blocked then
    raise exception 'POS-04 cash-session verify expected duplicate-open rejection';
  end if;

  -- scenario 5: cash completion succeeds and binds payment to current open session
  v_complete_1 := public.complete_pos_cash_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos04-cash-complete-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-complete-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_complete_1->>'sale_status', '') <> 'paid'
     or coalesce(v_complete_1->>'payment_status', '') <> 'paid'
     or (v_complete_1->>'cash_session_id')::uuid is distinct from v_session_id then
    raise exception 'POS-04 cash-session verify complete result invalid: %', v_complete_1;
  end if;

  select p.status, p.cash_session_id
    into v_payment_status, v_payment_cash_session_id
  from public.payments p
  where p.id = v_payment_id;

  select s.status
    into v_sale_status
  from public.pos_sales s
  where s.id = v_sale_id;

  if v_payment_status <> 'paid' or v_sale_status <> 'paid' then
    raise exception 'POS-04 cash-session verify paid status mismatch: sale %, payment %', v_sale_status, v_payment_status;
  end if;

  if v_payment_cash_session_id is distinct from v_session_id then
    raise exception 'POS-04 cash-session verify payment.cash_session_id mismatch: expected %, got %',
      v_session_id,
      v_payment_cash_session_id;
  end if;

  select count(*)::integer
    into v_complete_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_sale_completed'
    and l.target_id = v_sale_id;

  if v_complete_audit_count <> 1 then
    raise exception 'POS-04 cash-session verify expected one cash-complete audit row, got %', v_complete_audit_count;
  end if;

  -- scenario 6: idempotency replay for complete_pos_cash_sale
  v_complete_2 := public.complete_pos_cash_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos04-cash-complete-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-complete-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_complete_2->>'sale_id')::uuid is distinct from v_sale_id
     or (v_complete_2->>'payment_id')::uuid is distinct from v_payment_id
     or (v_complete_2->>'cash_session_id')::uuid is distinct from v_session_id then
    raise exception 'POS-04 cash-session verify complete replay mismatch: %', v_complete_2;
  end if;

  select count(*)::integer
    into v_complete_audit_count_after_replay
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_sale_completed'
    and l.target_id = v_sale_id;

  if v_complete_audit_count_after_replay <> 1 then
    raise exception 'POS-04 cash-session verify complete replay should not add audit rows, got %', v_complete_audit_count_after_replay;
  end if;

  -- scenario 7: close session and verify amount formulas
  v_close_1 := public.close_pos_cash_session(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_session_id := v_session_id,
    p_counted_cash := 139,
    p_notes := 'POS-04 close session verify',
    p_idempotency_key := format('pos04-cash-close-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-close-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_close_1->>'status', '') <> 'closed' then
    raise exception 'POS-04 cash-session verify close result invalid: %', v_close_1;
  end if;

  select s.status,
         s.opening_float,
         s.cash_in,
         s.cash_out,
         s.expected_cash,
         s.counted_cash,
         s.cash_over_short
    into v_session_status,
         v_session_opening_float,
         v_session_cash_in,
         v_session_cash_out,
         v_session_expected_cash,
         v_session_counted_cash,
         v_session_cash_over_short
  from public.pos_cash_sessions s
  where s.id = v_session_id;

  if v_session_status <> 'closed' then
    raise exception 'POS-04 cash-session verify session should be closed, got %', v_session_status;
  end if;

  if v_session_opening_float is distinct from 50::numeric
     or v_session_cash_in is distinct from 90::numeric
     or v_session_cash_out is distinct from 0::numeric
     or v_session_expected_cash is distinct from 140::numeric
     or v_session_counted_cash is distinct from 139::numeric
     or v_session_cash_over_short is distinct from (-1)::numeric then
    raise exception 'POS-04 cash-session verify close formula mismatch: opening %, in %, out %, expected %, counted %, over_short %',
      v_session_opening_float,
      v_session_cash_in,
      v_session_cash_out,
      v_session_expected_cash,
      v_session_counted_cash,
      v_session_cash_over_short;
  end if;

  select count(*)::integer
    into v_close_audit_count
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_session_closed'
    and l.target_id = v_session_id;

  if v_close_audit_count <> 1 then
    raise exception 'POS-04 cash-session verify expected one close audit row, got %', v_close_audit_count;
  end if;

  -- scenario 8: idempotency replay for close_pos_cash_session
  v_close_2 := public.close_pos_cash_session(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_session_id := v_session_id,
    p_counted_cash := 139,
    p_notes := 'POS-04 close session verify',
    p_idempotency_key := format('pos04-cash-close-%s', v_nonce),
    p_request_hash := encode(digest(format('pos04-cash-close-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_close_2->>'session_id')::uuid is distinct from v_session_id
     or coalesce(v_close_2->>'status', '') <> 'closed' then
    raise exception 'POS-04 cash-session verify close replay mismatch: %', v_close_2;
  end if;

  select count(*)::integer
    into v_close_audit_count_after_replay
  from public.strong_audit_logs l
  where l.studio_id = v_studio_id
    and l.action = 'pos_cash_session_closed'
    and l.target_id = v_session_id;

  if v_close_audit_count_after_replay <> 1 then
    raise exception 'POS-04 cash-session verify close replay should not add audit rows, got %', v_close_audit_count_after_replay;
  end if;
end;
$$;

select 'pos04_cash_sessions_ok' as result;
