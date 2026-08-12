do $$
declare
  v_studio_id uuid := '11111111-1111-1111-1111-111111111111';
  v_location_id uuid := '22222222-2222-2222-2222-222222222222';
  v_customer_id uuid := '33333333-3333-3333-3333-333333333333';
  v_actor_id uuid := '44444444-4444-4444-4444-444444444444';
  v_employee_id uuid := '55555555-5555-5555-5555-555555555555';
  v_service_id uuid := '66666666-6666-6666-6666-666666666666';

  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_sale_empty uuid;
  v_sale_mismatch uuid;
  v_sale_replay uuid;
  v_sale_in_progress uuid;
  v_claim jsonb;
  v_claim_id uuid;
  v_claim_token uuid;
  v_fail_result jsonb;

  v_lock_replay_key text;
  v_lock_replay_hash text;
  v_lock_replay_1 jsonb;
  v_lock_replay_2 jsonb;

  v_hash_conflict_hash text;

  v_in_progress_key text;
  v_in_progress_hash text;
begin
  insert into public.studios (id, owner_id, contract_status)
  values (v_studio_id, v_actor_id, 'active')
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.users (id, email)
  values (v_actor_id, 'pos01-v3@example.com')
  on conflict (id) do nothing;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'POS Branch')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name)
  values (v_customer_id, v_studio_id, 'POS Customer')
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name)
  values (v_employee_id, v_studio_id, 'POS Employee')
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name)
  values (v_service_id, v_studio_id, 'POS Service')
  on conflict (id) do nothing;

  -- empty sale lock must fail
  v_sale_empty := (public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'v3 empty sale',
    p_idempotency_key := format('pos01-v3-empty-create-%s', v_nonce),
    p_request_hash := encode(digest(format('empty-create-%s', v_nonce), 'sha256'), 'hex')
  )->>'sale_id')::uuid;

  begin
    perform public.lock_pos_sale(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_empty,
      p_idempotency_key := format('pos01-v3-empty-lock-%s', v_nonce),
      p_request_hash := encode(digest(format('empty-lock-%s', v_nonce), 'sha256'), 'hex')
    );
    raise exception 'expected lock_pos_sale to reject empty sale';
  exception
    when sqlstate '23514' then
      if sqlerrm not ilike '%empty items%' then
        raise exception 'expected empty-items message, got: %', sqlerrm;
      end if;
  end;

  -- sale/item totals mismatch must fail before lock
  v_sale_mismatch := (public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'v3 mismatch sale',
    p_idempotency_key := format('pos01-v3-mismatch-create-%s', v_nonce),
    p_request_hash := encode(digest(format('mismatch-create-%s', v_nonce), 'sha256'), 'hex')
  )->>'sale_id')::uuid;

  perform public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_mismatch,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'Mismatch Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 10,
    p_tax_amount := 5,
    p_idempotency_key := format('pos01-v3-mismatch-item-%s', v_nonce),
    p_request_hash := encode(digest(format('mismatch-item-%s', v_nonce), 'sha256'), 'hex')
  );

  update public.pos_sales
  set subtotal_amount = 110,
      discount_amount = 10,
      tax_amount = 5,
      total_amount = 105,
      updated_by = v_actor_id
  where id = v_sale_mismatch;

  begin
    perform public.lock_pos_sale(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_mismatch,
      p_idempotency_key := format('pos01-v3-mismatch-lock-%s', v_nonce),
      p_request_hash := encode(digest(format('mismatch-lock-%s', v_nonce), 'sha256'), 'hex')
    );
    raise exception 'expected lock_pos_sale to reject totals mismatch';
  exception
    when sqlstate '23514' then
      if sqlerrm not ilike '%totals mismatch%' then
        raise exception 'expected totals-mismatch message, got: %', sqlerrm;
      end if;
  end;

  -- replay same key/hash must be stable
  v_sale_replay := (public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'v3 replay sale',
    p_idempotency_key := format('pos01-v3-replay-create-%s', v_nonce),
    p_request_hash := encode(digest(format('replay-create-%s', v_nonce), 'sha256'), 'hex')
  )->>'sale_id')::uuid;

  perform public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_replay,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'Replay Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 90,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos01-v3-replay-item-%s', v_nonce),
    p_request_hash := encode(digest(format('replay-item-%s', v_nonce), 'sha256'), 'hex')
  );

  v_lock_replay_key := format('pos01-v3-replay-lock-%s', v_nonce);
  v_lock_replay_hash := encode(digest(format('replay-lock-%s', v_nonce), 'sha256'), 'hex');
  v_hash_conflict_hash := encode(digest(format('replay-lock-conflict-%s', v_nonce), 'sha256'), 'hex');

  v_lock_replay_1 := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_replay,
    p_idempotency_key := v_lock_replay_key,
    p_request_hash := v_lock_replay_hash
  );

  v_lock_replay_2 := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_replay,
    p_idempotency_key := v_lock_replay_key,
    p_request_hash := v_lock_replay_hash
  );

  if (v_lock_replay_1->>'sale_id')::uuid is distinct from v_sale_replay
    or (v_lock_replay_2->>'sale_id')::uuid is distinct from v_sale_replay then
    raise exception 'replay lock returned unexpected sale binding';
  end if;

  begin
    perform public.lock_pos_sale(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_replay,
      p_idempotency_key := v_lock_replay_key,
      p_request_hash := v_hash_conflict_hash
    );
    raise exception 'expected hash_conflict lock replay rejection';
  exception
    when sqlstate '23514' then
      if sqlerrm not ilike '%hash_conflict%' then
        raise exception 'expected hash_conflict message, got: %', sqlerrm;
      end if;
  end;

  -- in_progress boundary: external claim still active
  v_sale_in_progress := (public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'v3 in progress sale',
    p_idempotency_key := format('pos01-v3-inprog-create-%s', v_nonce),
    p_request_hash := encode(digest(format('inprog-create-%s', v_nonce), 'sha256'), 'hex')
  )->>'sale_id')::uuid;

  perform public.upsert_pos_sale_item(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_in_progress,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := null,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'InProgress Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 70,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos01-v3-inprog-item-%s', v_nonce),
    p_request_hash := encode(digest(format('inprog-item-%s', v_nonce), 'sha256'), 'hex')
  );

  v_in_progress_key := format('pos01-v3-inprog-lock-%s', v_nonce);
  v_in_progress_hash := encode(digest(format('inprog-lock-%s', v_nonce), 'sha256'), 'hex');

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := v_studio_id,
    p_operation_scope := 'pos_sale:lock',
    p_idempotency_key := v_in_progress_key,
    p_request_hash := v_in_progress_hash,
    p_stale_after_seconds := 300
  );

  v_claim_id := (v_claim->>'id')::uuid;
  v_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    perform public.lock_pos_sale(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_in_progress,
      p_idempotency_key := v_in_progress_key,
      p_request_hash := v_in_progress_hash
    );
    raise exception 'expected in_progress lock replay rejection';
  exception
    when sqlstate '23514' then
      if sqlerrm not ilike '%in_progress%' then
        raise exception 'expected in_progress message, got: %', sqlerrm;
      end if;
  end;

  v_fail_result := public.fail_business_idempotency_key(
    p_id := v_claim_id,
    p_claim_token := v_claim_token,
    p_error_summary := 'cleanup in_progress claim',
    p_retryable := true
  );

  if coalesce((v_fail_result->>'ok')::boolean, false) is false then
    raise exception 'expected in-progress cleanup fail() to succeed: %', v_fail_result;
  end if;

  raise notice 'verify_pos01_write_rpcs_v3: ok';
end;
$$;
