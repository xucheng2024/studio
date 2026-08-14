\set ON_ERROR_STOP on

select set_config('app.run_id', :'run_id', false);

do $$
declare
  v_run_id text := current_setting('app.run_id');

  v_studio_id uuid := 'e1000000-0000-4000-8000-000000000001';
  v_other_studio_id uuid := 'e2000000-0000-4000-8000-000000000001';
  v_location_l1 uuid := 'e1000000-0000-4000-8000-000000000011';
  v_location_l2 uuid := 'e1000000-0000-4000-8000-000000000012';
  v_other_location_id uuid := 'e2000000-0000-4000-8000-000000000011';

  v_owner_id uuid := 'd1000000-0000-0000-0000-000000000101';
  v_manager_id uuid := 'd1000000-0000-0000-0000-000000000102';
  v_frontdesk_l1_id uuid := 'd1000000-0000-0000-0000-000000000103';
  v_frontdesk_l2_id uuid := 'd1000000-0000-0000-0000-000000000104';
  v_instructor_user_id uuid := 'd1000000-0000-0000-0000-000000000105';
  v_other_owner_id uuid := 'd2000000-0000-0000-0000-000000000101';

  v_employee_id uuid := 'e1000000-0000-4000-8000-000000000201';
  v_instructor_employee_id uuid := 'e1000000-0000-4000-8000-000000000202';
  v_customer_id uuid := 'e1000000-0000-4000-8000-000000000301';
  v_service_id uuid := 'e1000000-0000-4000-8000-000000000401';

  v_appt_paid_first uuid := 'e1000000-0000-4000-8000-000000000501';
  v_appt_complete_first uuid := 'e1000000-0000-4000-8000-000000000502';

  v_sale jsonb;
  v_item jsonb;
  v_sale_id uuid;
  v_item_id uuid;
  v_payment_id uuid;
  v_count integer;
  v_result jsonb;
  v_forbidden boolean := false;
  v_role_denied boolean := false;
begin
  insert into public.users (id, email) values
    (v_owner_id, 'com01-owner@example.com'),
    (v_manager_id, 'com01-manager@example.com'),
    (v_frontdesk_l1_id, 'com01-frontdesk-l1@example.com'),
    (v_frontdesk_l2_id, 'com01-frontdesk-l2@example.com'),
    (v_instructor_user_id, 'com01-instructor@example.com'),
    (v_other_owner_id, 'com01-other-owner@example.com')
  on conflict (id) do update set email = excluded.email;

  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner_id, 'com01-owner@example.com', 'COM01 Owner', 'member'),
    (v_manager_id, 'com01-manager@example.com', 'COM01 Manager', 'member'),
    (v_frontdesk_l1_id, 'com01-frontdesk-l1@example.com', 'COM01 Frontdesk L1', 'member'),
    (v_frontdesk_l2_id, 'com01-frontdesk-l2@example.com', 'COM01 Frontdesk L2', 'member'),
    (v_instructor_user_id, 'com01-instructor@example.com', 'COM01 Instructor', 'member'),
    (v_other_owner_id, 'com01-other-owner@example.com', 'COM01 Other Owner', 'member')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role;

  insert into public.studios (id, name, public_slug, owner_id, contract_status) values
    (v_studio_id, 'COM01 UAT Studio V2', 'com01-uat-v2-studio', v_owner_id, 'active'),
    (v_other_studio_id, 'COM01 UAT Other Studio V2', 'com01-uat-v2-other-studio', v_other_owner_id, 'active')
  on conflict (id) do update set
    name = excluded.name,
    public_slug = excluded.public_slug,
    owner_id = excluded.owner_id,
    contract_status = excluded.contract_status;

  insert into public.locations (id, studio_id, name, is_active) values
    (v_location_l1, v_studio_id, 'COM01-L1', true),
    (v_location_l2, v_studio_id, 'COM01-L2', true),
    (v_other_location_id, v_other_studio_id, 'COM01-Other', true)
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    name = excluded.name,
    is_active = excluded.is_active;

  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    ('e1000000-0000-4000-8000-000000001001'::uuid, v_manager_id, v_studio_id, null, 'manager', true),
    ('e1000000-0000-4000-8000-000000001002'::uuid, v_frontdesk_l1_id, v_studio_id, v_location_l1, 'frontdesk', true),
    ('e1000000-0000-4000-8000-000000001003'::uuid, v_frontdesk_l2_id, v_studio_id, v_location_l2, 'frontdesk', true),
    ('e1000000-0000-4000-8000-000000001004'::uuid, v_instructor_user_id, v_studio_id, v_location_l1, 'instructor', true)
  on conflict (id) do update set
    user_id = excluded.user_id,
    studio_id = excluded.studio_id,
    location_id = excluded.location_id,
    role = excluded.role,
    is_active = excluded.is_active;

  insert into public.studio_services (
    id, studio_id, title, price, currency, is_active,
    default_duration_minutes, default_prep_minutes, default_buffer_minutes
  ) values (
    v_service_id, v_studio_id, 'COM01 Service', 100, 'SGD', true, 60, 10, 10
  )
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    title = excluded.title,
    price = excluded.price,
    currency = excluded.currency,
    is_active = excluded.is_active,
    default_duration_minutes = excluded.default_duration_minutes,
    default_prep_minutes = excluded.default_prep_minutes,
    default_buffer_minutes = excluded.default_buffer_minutes;

  insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values) values
    (v_service_id, v_location_l1, v_studio_id, true, true),
    (v_service_id, v_location_l2, v_studio_id, true, true)
  on conflict (service_id, location_id) do update set
    studio_id = excluded.studio_id,
    is_enabled = excluded.is_enabled,
    uses_default_values = excluded.uses_default_values;

  insert into public.employees (id, studio_id, user_id, display_name, employment_status) values
    (v_employee_id, v_studio_id, null, 'COM01 Employee', 'active'),
    (v_instructor_employee_id, v_studio_id, v_instructor_user_id, 'COM01 Instructor Employee', 'active')
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    user_id = excluded.user_id,
    display_name = excluded.display_name,
    employment_status = excluded.employment_status;

  insert into public.employee_locations (id, employee_id, location_id, studio_id, is_primary, is_active) values
    ('e1000000-0000-4000-8000-000000002001'::uuid, v_employee_id, v_location_l1, v_studio_id, true, true),
    ('e1000000-0000-4000-8000-000000002002'::uuid, v_employee_id, v_location_l2, v_studio_id, false, true),
    ('e1000000-0000-4000-8000-000000002003'::uuid, v_instructor_employee_id, v_location_l1, v_studio_id, true, true)
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    location_id = excluded.location_id,
    studio_id = excluded.studio_id,
    is_primary = excluded.is_primary,
    is_active = excluded.is_active;

  insert into public.service_employees (id, studio_id, service_id, employee_id, is_active) values
    ('e1000000-0000-4000-8000-000000003001'::uuid, v_studio_id, v_service_id, v_employee_id, true),
    ('e1000000-0000-4000-8000-000000003002'::uuid, v_studio_id, v_service_id, v_instructor_employee_id, true)
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    service_id = excluded.service_id,
    employee_id = excluded.employee_id,
    is_active = excluded.is_active;

  insert into public.salon_customers (id, studio_id, full_name, email, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'COM01 Customer', 'com01-customer@example.com', 'active', 'frontdesk', v_location_l1)
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = excluded.status,
    source = excluded.source,
    preferred_location_id = excluded.preferred_location_id;

  insert into public.employee_service_commission_rules (
    id, studio_id, location_id, employee_id, service_id,
    commission_type, percent_rate, currency, rule_version, effective_from, created_by, is_active
  )
  values (
    'e1000000-0000-4000-8000-000000004001'::uuid,
    v_studio_id, null, null, v_service_id,
    'percent', 10, 'SGD', 1, now() - interval '1 day', v_owner_id, true
  )
  on conflict (id) do update set
    studio_id = excluded.studio_id,
    location_id = excluded.location_id,
    employee_id = excluded.employee_id,
    service_id = excluded.service_id,
    commission_type = excluded.commission_type,
    percent_rate = excluded.percent_rate,
    currency = excluded.currency,
    rule_version = excluded.rule_version,
    effective_from = excluded.effective_from,
    created_by = excluded.created_by,
    is_active = excluded.is_active;

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id, status,
    starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot,
    created_by, updated_by
  ) values
  (
    v_appt_paid_first, v_studio_id, v_location_l1, v_customer_id, v_service_id, v_employee_id, 'in_progress',
    now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '1 day -10 minute', now() + interval '1 day 1 hour 10 minute',
    'COM01 Service', 100, 'SGD', 60, 10, 10,
    'COM01 Employee', 'COM01-L1', v_owner_id, v_owner_id
  ),
  (
    v_appt_complete_first, v_studio_id, v_location_l1, v_customer_id, v_service_id, v_employee_id, 'in_progress',
    now() + interval '2 day', now() + interval '2 day 1 hour', now() + interval '2 day -10 minute', now() + interval '2 day 1 hour 10 minute',
    'COM01 Service', 100, 'SGD', 60, 10, 10,
    'COM01 Employee', 'COM01-L1', v_owner_id, v_owner_id
  )
  on conflict (id) do update set
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    occupied_from = excluded.occupied_from,
    occupied_until = excluded.occupied_until,
    updated_by = excluded.updated_by,
    updated_at = now();

  perform public.open_pos_cash_session(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_opening_float := 200,
    p_notes := v_run_id || ' cash session open',
    p_idempotency_key := lower(v_run_id) || '-cash-session-open-l1',
    p_request_hash := encode(digest(lower(v_run_id) || '-cash-session-open-l1', 'sha256'), 'hex')
  );

  -- S1 Appointment paid first (HitPay) then complete
  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := v_run_id || '-APT-PAID-FIRST-HITPAY',
    p_idempotency_key := lower(v_run_id) || '-apt-pf-create',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-pf-create', 'sha256'), 'hex')
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
    p_salon_appointment_id := v_appt_paid_first,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := lower(v_run_id) || '-apt-pf-item',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-pf-item', 'sha256'), 'hex')
  );
  v_item_id := (v_item->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-apt-pf-lock',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-pf-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, v_sale_id, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', v_run_id || '-APT-PF-HP', 'single', 0
  ) returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := v_sale_id,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-' || lower(v_run_id) || '-apt-pf',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 0 then
    raise exception 'S1 should not earn before appointment complete, got %', v_count;
  end if;

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_paid_first,
    p_to_status := 'completed'
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 1 then
    raise exception 'S1 expected exactly one earned, got %', v_count;
  end if;

  -- S2 Appointment complete first then cash pay
  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := v_run_id || '-APT-COMPLETE-FIRST-CASH',
    p_idempotency_key := lower(v_run_id) || '-apt-cf-create',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-cf-create', 'sha256'), 'hex')
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
    p_salon_appointment_id := v_appt_complete_first,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := lower(v_run_id) || '-apt-cf-item',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-cf-item', 'sha256'), 'hex')
  );
  v_item_id := (v_item->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-apt-cf-lock',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-cf-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, v_sale_id, 100, 'SGD', 'cash', 'frontdesk', 'pos_sale', 'pending', v_run_id || '-APT-CF-CASH', 'single', 0
  );

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_complete_first,
    p_to_status := 'completed'
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 0 then
    raise exception 'S2 should not earn before payment, got %', v_count;
  end if;

  perform public.complete_pos_cash_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-apt-cf-pay',
    p_request_hash := encode(digest(lower(v_run_id) || '-apt-cf-pay', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 1 then
    raise exception 'S2 expected exactly one earned, got %', v_count;
  end if;

  -- S3 Walk-in paid first cash then fulfill
  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := v_run_id || '-WALKIN-PAID-FIRST-CASH',
    p_idempotency_key := lower(v_run_id) || '-walkin-pf-create',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-pf-create', 'sha256'), 'hex')
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
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := lower(v_run_id) || '-walkin-pf-item',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-pf-item', 'sha256'), 'hex')
  );
  v_item_id := (v_item->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-walkin-pf-lock',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-pf-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, v_sale_id, 100, 'SGD', 'cash', 'frontdesk', 'pos_sale', 'pending', v_run_id || '-WALKIN-PF-CASH', 'single', 0
  );

  perform public.complete_pos_cash_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-walkin-pf-pay',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-pf-pay', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 0 then
    raise exception 'S3 should not earn before fulfill, got %', v_count;
  end if;

  perform public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'walkin paid first fulfill',
    p_idempotency_key := lower(v_run_id) || '-walkin-pf-fulfill',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-pf-fulfill', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 1 then
    raise exception 'S3 expected exactly one earned, got %', v_count;
  end if;

  -- Refund partial + full on S3 item
  perform public.refund_pos_sale_items(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_items := jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'refund_amount', 30)),
    p_reason := 'uat partial refund',
    p_idempotency_key := lower(v_run_id) || '-refund-partial',
    p_request_hash := encode(digest(lower(v_run_id) || '-refund-partial', 'sha256'), 'hex')
  );

  perform public.refund_pos_sale_items(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_items := jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'refund_amount', 70)),
    p_reason := 'uat full refund',
    p_idempotency_key := lower(v_run_id) || '-refund-full',
    p_request_hash := encode(digest(lower(v_run_id) || '-refund-full', 'sha256'), 'hex')
  );

  -- S4 Walk-in fulfill first then HitPay pay
  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := v_run_id || '-WALKIN-FULFILL-FIRST-HITPAY',
    p_idempotency_key := lower(v_run_id) || '-walkin-cf-create',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-cf-create', 'sha256'), 'hex')
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
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := lower(v_run_id) || '-walkin-cf-item',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-cf-item', 'sha256'), 'hex')
  );
  v_item_id := (v_item->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := lower(v_run_id) || '-walkin-cf-lock',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-cf-lock', 'sha256'), 'hex')
  );

  perform public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'walkin fulfill first',
    p_idempotency_key := lower(v_run_id) || '-walkin-cf-fulfill',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-cf-fulfill', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 0 then
    raise exception 'S4 should not earn before payment, got %', v_count;
  end if;

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, v_sale_id, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', v_run_id || '-WALKIN-CF-HP', 'single', 0
  ) returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := v_sale_id,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-' || lower(v_run_id) || '-walkin-cf',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 1 then
    raise exception 'S4 expected exactly one earned, got %', v_count;
  end if;

  -- Idempotency replay: repeated fulfill on same item must not duplicate
  perform public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'walkin fulfill replay',
    p_idempotency_key := lower(v_run_id) || '-walkin-cf-fulfill',
    p_request_hash := encode(digest(lower(v_run_id) || '-walkin-cf-fulfill', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_id and entry_type = 'earned';
  if v_count <> 1 then
    raise exception 'Replay should keep one earned entry, got %', v_count;
  end if;

  -- Cross-location deny (frontdesk L2 cannot fulfill L1 item)
  v_sale := public.create_pos_sale_draft(
    p_actor_id := v_frontdesk_l1_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := v_run_id || '-CROSS-LOCATION-DENY',
    p_idempotency_key := lower(v_run_id) || '-cross-location-create',
    p_request_hash := encode(digest(lower(v_run_id) || '-cross-location-create', 'sha256'), 'hex')
  );
  v_sale_id := (v_sale->>'sale_id')::uuid;

  v_item := public.upsert_pos_sale_item(
    p_actor_id := v_frontdesk_l1_id,
    p_actor_role := 'frontdesk',
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
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := lower(v_run_id) || '-cross-location-item',
    p_request_hash := encode(digest(lower(v_run_id) || '-cross-location-item', 'sha256'), 'hex')
  );
  v_item_id := (v_item->>'item_id')::uuid;

  begin
    perform public.com01_mark_pos_service_item_fulfilled(
      p_actor_id := v_frontdesk_l2_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_sale_item_id := v_item_id,
      p_fulfilled_at := now(),
      p_fulfillment_note := 'cross location denied',
      p_idempotency_key := lower(v_run_id) || '-cross-location-denied',
      p_request_hash := encode(digest(lower(v_run_id) || '-cross-location-denied', 'sha256'), 'hex')
    );
  exception
    when sqlstate '42501' then
      v_forbidden := true;
  end;

  if not v_forbidden then
    raise exception 'expected cross-location frontdesk denial';
  end if;

  -- Instructor denied
  begin
    perform public.com01_mark_pos_service_item_fulfilled(
      p_actor_id := v_instructor_user_id,
      p_actor_role := 'instructor',
      p_studio_id := v_studio_id,
      p_sale_item_id := v_item_id,
      p_fulfilled_at := now(),
      p_fulfillment_note := 'instructor denied',
      p_idempotency_key := lower(v_run_id) || '-role-denied',
      p_request_hash := encode(digest(lower(v_run_id) || '-role-denied', 'sha256'), 'hex')
    );
  exception
    when sqlstate '42501' then
      v_role_denied := true;
  end;

  if not v_role_denied then
    raise exception 'expected instructor role denial';
  end if;
end;
$$;

select 'com01_uat_local_ok' as result;
