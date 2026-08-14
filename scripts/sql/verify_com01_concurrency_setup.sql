do $$
declare
  v_studio_id uuid := 'e1000000-0000-0000-0000-000000000001';
  v_location_id uuid := 'e1000000-0000-0000-0000-000000000011';
  v_owner_id uuid := 'e1000000-0000-0000-0000-000000000101';
  v_employee_id uuid := 'e1000000-0000-0000-0000-000000000201';
  v_customer_id uuid := 'e1000000-0000-0000-0000-000000000301';
  v_service_id uuid := 'e1000000-0000-0000-0000-000000000401';
  v_sale jsonb;
  v_item jsonb;
  v_sale_id uuid;
begin
  insert into public.users (id, email)
  values (v_owner_id, 'com01-concurrency-owner@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id)
  values (v_studio_id, 'active', v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'COM01-CONC-L1', true)
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active)
  values (v_service_id, v_studio_id, 'COM01 CONC Service', 120, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
  values (v_studio_id, v_service_id, v_location_id, true, true)
  on conflict (service_id, location_id) do update set is_enabled = excluded.is_enabled;

  insert into public.employees (id, studio_id, display_name, employment_status, is_active)
  values (v_employee_id, v_studio_id, 'COM01 CONC Employee', 'active', true)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.employee_locations where employee_id = v_employee_id and location_id = v_location_id
  ) then
    insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
    values (v_employee_id, v_location_id, v_studio_id, true, true);
  end if;

  insert into public.service_employees (studio_id, service_id, employee_id, is_active)
  values (v_studio_id, v_service_id, v_employee_id, true)
  on conflict (service_id, employee_id) do update set is_active = excluded.is_active;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'COM01 CONC Customer', 'active', 'frontdesk', v_location_id)
  on conflict (id) do nothing;

  insert into public.employee_service_commission_rules (
    studio_id,
    location_id,
    employee_id,
    service_id,
    commission_type,
    percent_rate,
    currency,
    rule_version,
    effective_from,
    created_by
  )
  values (
    v_studio_id,
    null,
    null,
    v_service_id,
    'percent',
    10,
    'SGD',
    1,
    now() - interval '1 day',
    v_owner_id
  )
  on conflict do nothing;

  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 concurrency deadlock test',
    p_idempotency_key := 'com01-conc-create',
    p_request_hash := encode(digest('com01-conc-create', 'sha256'), 'hex')
  );
  v_sale_id := (v_sale->>'sale_id')::uuid;

  v_item := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
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
    p_item_name_snapshot := 'COM01 CONC Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 120,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := 'com01-conc-item',
    p_request_hash := encode(digest('com01-conc-item', 'sha256'), 'hex')
  );

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := 'com01-conc-lock',
    p_request_hash := encode(digest('com01-conc-lock', 'sha256'), 'hex')
  );

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
    120,
    'SGD',
    'hitpay',
    'frontdesk',
    'pos_sale',
    'pending',
    'COM01-CONC-REF',
    'single',
    0
  )
  on conflict (reference_code) do nothing;
end;
$$;

