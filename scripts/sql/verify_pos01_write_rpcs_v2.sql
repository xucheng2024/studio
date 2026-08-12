do $$
declare
  v_studio_id uuid := '11111111-1111-1111-1111-111111111111';
  v_location_id uuid := '22222222-2222-2222-2222-222222222222';
  v_customer_id uuid := '33333333-3333-3333-3333-333333333333';
  v_actor_id uuid := '44444444-4444-4444-4444-444444444444';
  v_employee_id uuid := '55555555-5555-5555-5555-555555555555';
  v_service_id uuid := '66666666-6666-6666-6666-666666666666';

  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_create_key text;
  v_create_hash text;
  v_item_key text;
  v_item_hash text;
  v_lock_key text;
  v_lock_hash text;
  v_post_lock_key text;
  v_post_lock_hash text;

  v_create_1 jsonb;
  v_create_2 jsonb;
  v_item_1 jsonb;
  v_item_2 jsonb;
  v_lock_1 jsonb;
  v_lock_2 jsonb;

  v_sale_id uuid;
  v_item_id uuid;
  v_sale_status text;
  v_item_count integer;
begin
  if to_regprocedure('public.create_pos_sale_draft(uuid,text,uuid,uuid,uuid,text,text,text)') is null then
    raise exception 'missing rpc public.create_pos_sale_draft';
  end if;

  if to_regprocedure('public.upsert_pos_sale_item(uuid,text,uuid,uuid,uuid,integer,text,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,text,text)') is null then
    raise exception 'missing rpc public.upsert_pos_sale_item';
  end if;

  if to_regprocedure('public.lock_pos_sale(uuid,text,uuid,uuid,text,text)') is null then
    raise exception 'missing rpc public.lock_pos_sale';
  end if;

  insert into public.studios (id, owner_id, contract_status)
  values (v_studio_id, v_actor_id, 'active')
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.users (id, email)
  values (v_actor_id, 'pos01-v2@example.com')
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

  v_create_key := format('pos01-v2-create-%s', v_nonce);
  v_create_hash := encode(digest(format('create-%s', v_nonce), 'sha256'), 'hex');

  v_create_1 := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'verify pos01 v2',
    p_idempotency_key := v_create_key,
    p_request_hash := v_create_hash
  );

  v_create_2 := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'verify pos01 v2',
    p_idempotency_key := v_create_key,
    p_request_hash := v_create_hash
  );

  v_sale_id := (v_create_1->>'sale_id')::uuid;

  if v_sale_id is null then
    raise exception 'create_pos_sale_draft did not return sale_id: %', v_create_1;
  end if;

  if (v_create_2->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'duplicate create idempotency key returned different sale_id: % vs %', v_sale_id, v_create_2->>'sale_id';
  end if;

  v_item_key := format('pos01-v2-item-%s', v_nonce);
  v_item_hash := encode(digest(format('item-%s', v_nonce), 'sha256'), 'hex');

  v_item_1 := public.upsert_pos_sale_item(
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
    p_item_name_snapshot := 'POS Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 120,
    p_discount_amount := 20,
    p_tax_amount := 8,
    p_idempotency_key := v_item_key,
    p_request_hash := v_item_hash
  );

  v_item_2 := public.upsert_pos_sale_item(
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
    p_item_name_snapshot := 'POS Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 120,
    p_discount_amount := 20,
    p_tax_amount := 8,
    p_idempotency_key := v_item_key,
    p_request_hash := v_item_hash
  );

  v_item_id := (v_item_1->>'item_id')::uuid;

  if v_item_id is null then
    raise exception 'upsert_pos_sale_item did not return item_id: %', v_item_1;
  end if;

  if (v_item_2->>'item_id')::uuid is distinct from v_item_id then
    raise exception 'duplicate upsert idempotency key returned different item_id: % vs %', v_item_id, v_item_2->>'item_id';
  end if;

  select count(*)::integer into v_item_count
  from public.pos_sale_items
  where sale_id = v_sale_id;

  if v_item_count <> 1 then
    raise exception 'expected exactly 1 item after duplicate upsert, got %', v_item_count;
  end if;

  v_lock_key := format('pos01-v2-lock-%s', v_nonce);
  v_lock_hash := encode(digest(format('lock-%s', v_nonce), 'sha256'), 'hex');

  v_lock_1 := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := v_lock_key,
    p_request_hash := v_lock_hash
  );

  v_lock_2 := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := v_lock_key,
    p_request_hash := v_lock_hash
  );

  if (v_lock_1->>'sale_id')::uuid is distinct from v_sale_id or (v_lock_2->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'lock_pos_sale idempotency replay changed sale binding';
  end if;

  select status into v_sale_status
  from public.pos_sales
  where id = v_sale_id;

  if v_sale_status <> 'pending_payment' then
    raise exception 'expected sale to be pending_payment after lock, got %', v_sale_status;
  end if;

  v_post_lock_key := format('pos01-v2-post-lock-upsert-%s', v_nonce);
  v_post_lock_hash := encode(digest(format('post-lock-upsert-%s', v_nonce), 'sha256'), 'hex');

  begin
    perform public.upsert_pos_sale_item(
      p_actor_id := v_actor_id,
      p_actor_role := 'owner',
      p_studio_id := v_studio_id,
      p_sale_id := v_sale_id,
      p_item_id := v_item_id,
      p_line_number := 1,
      p_item_type := 'service',
      p_service_id := v_service_id,
      p_product_id := null,
      p_package_id := null,
      p_salon_appointment_id := null,
      p_employee_id := v_employee_id,
      p_item_name_snapshot := 'POS Service Snapshot Updated',
      p_item_currency_snapshot := 'SGD',
      p_quantity := 1,
      p_unit_price_amount := 120,
      p_discount_amount := 10,
      p_tax_amount := 8,
      p_idempotency_key := v_post_lock_key,
      p_request_hash := v_post_lock_hash
    );

    raise exception 'expected upsert_pos_sale_item to fail when sale already locked';
  exception
    when sqlstate '23514' then
      null;
  end;

  raise notice 'verify_pos01_write_rpcs_v2: ok';
end;
$$;
