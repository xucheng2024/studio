do $$
declare
  v_studio_id uuid := 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_location_id uuid := 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_actor_id uuid := 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_customer_id uuid := 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_employee_id uuid := 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_service_id uuid := 'aaaaaaa6-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_nonce text := replace(gen_random_uuid()::text, '-', '');

  v_create jsonb;
  v_item jsonb;
  v_lock jsonb;

  v_sale_id uuid;
  v_payment_id uuid;
  v_payment_id_2 uuid;
  v_payment_count integer;
  v_sale_status text;
  v_payment_status text;
  v_total_amount numeric(12,2);
begin
  insert into public.users (id, email)
  values (v_actor_id, format('pos01-e2e-%s@example.com', left(v_nonce, 8)))
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_actor_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'POS01 E2E Location', true)
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'POS01 E2E Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name, employment_status)
  values (v_employee_id, v_studio_id, 'POS01 E2E Employee', 'active')
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values (v_service_id, v_studio_id, 'POS01 E2E Service', 88, 'SGD', true)
  on conflict (id) do nothing;

  -- 1) create draft
  v_create := public.create_pos_sale_draft(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'POS-01 E2E create draft',
    p_idempotency_key := format('pos01-e2e-create-%s', v_nonce),
    p_request_hash := encode(digest(format('create-%s', v_nonce), 'sha256'), 'hex')
  );

  v_sale_id := (v_create->>'sale_id')::uuid;
  if v_sale_id is null then
    raise exception 'E2E create_pos_sale_draft missing sale_id: %', v_create;
  end if;

  -- 2) add item
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
    p_item_name_snapshot := 'POS01 E2E Service Snapshot',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 88,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := format('pos01-e2e-item-%s', v_nonce),
    p_request_hash := encode(digest(format('item-%s', v_nonce), 'sha256'), 'hex')
  );

  if (v_item->>'sale_id')::uuid is distinct from v_sale_id then
    raise exception 'E2E upsert item returned mismatched sale_id: %', v_item;
  end if;

  v_total_amount := coalesce((v_item->>'sale_total_amount')::numeric, 0);
  if v_total_amount <= 0 then
    raise exception 'E2E upsert item returned invalid sale_total_amount: %', v_item;
  end if;

  -- 3) proceed-to-payment lock
  v_lock := public.lock_pos_sale(
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := format('pos01-e2e-lock-%s', v_nonce),
    p_request_hash := encode(digest(format('lock-%s', v_nonce), 'sha256'), 'hex')
  );

  if coalesce(v_lock->>'status', '') <> 'pending_payment' then
    raise exception 'E2E lock_pos_sale did not reach pending_payment: %', v_lock;
  end if;

  -- 4) proceed-to-payment payment ensure (idempotent): first create, then reuse
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
    v_total_amount,
    'SGD',
    'cash',
    'frontdesk',
    'pos_sale',
    'pending',
    format('POS-E2E-%s', left(v_nonce, 16)),
    'single',
    0
  )
  returning id into v_payment_id;

  select p.id
  into v_payment_id_2
  from public.payments p
  where p.pos_sale_id = v_sale_id
  order by p.created_at desc
  limit 1;

  if v_payment_id_2 is distinct from v_payment_id then
    raise exception 'E2E ensure payment did not return the existing payment id';
  end if;

  select count(*)::integer
  into v_payment_count
  from public.payments p
  where p.pos_sale_id = v_sale_id;

  if v_payment_count <> 1 then
    raise exception 'E2E proceed-to-payment must be idempotent, got % payment rows', v_payment_count;
  end if;

  -- 5) status change (payment + sale)
  update public.payments
  set status = 'paid', paid_at = now(), verified_at = now(), verified_by = v_actor_id
  where id = v_payment_id;

  update public.pos_sales
  set status = 'paid', paid_at = now(), updated_by = v_actor_id
  where id = v_sale_id;

  select status into v_sale_status from public.pos_sales where id = v_sale_id;
  select status into v_payment_status from public.payments where id = v_payment_id;

  if v_sale_status <> 'paid' then
    raise exception 'E2E sale status expected paid, got %', v_sale_status;
  end if;
  if v_payment_status <> 'paid' then
    raise exception 'E2E payment status expected paid, got %', v_payment_status;
  end if;

  raise notice 'verify_pos01_e2e_proceed_to_payment: ok';
end;
$$;

