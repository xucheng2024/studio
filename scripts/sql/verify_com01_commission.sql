do $$
declare
  v_studio_id uuid := 'd1000000-0000-0000-0000-000000000001';
  v_location_l1 uuid := 'd1000000-0000-0000-0000-000000000011';
  v_location_l2 uuid := 'd1000000-0000-0000-0000-000000000012';
  v_owner_id uuid := 'd1000000-0000-0000-0000-000000000101';
  v_manager_id uuid := 'd1000000-0000-0000-0000-000000000102';
  v_frontdesk_l1_id uuid := 'd1000000-0000-0000-0000-000000000103';
  v_frontdesk_l2_id uuid := 'd1000000-0000-0000-0000-000000000104';
  v_instructor_user_id uuid := 'd1000000-0000-0000-0000-000000000105';
  v_employee_id uuid := 'd1000000-0000-0000-0000-000000000201';
  v_instructor_employee_id uuid := 'd1000000-0000-0000-0000-000000000202';
  v_customer_id uuid := 'd1000000-0000-0000-0000-000000000301';
  v_service_id uuid := 'd1000000-0000-0000-0000-000000000401';

  v_other_studio_id uuid := 'd2000000-0000-0000-0000-000000000001';
  v_other_location_id uuid := 'd2000000-0000-0000-0000-000000000011';
  v_other_owner_id uuid := 'd2000000-0000-0000-0000-000000000101';

  v_appt_paid_first uuid := 'd1000000-0000-0000-0000-000000000501';
  v_appt_completed_first uuid := 'd1000000-0000-0000-0000-000000000502';
  v_appt_rule_timing uuid := 'd1000000-0000-0000-0000-000000000503';
  v_appt_mismatch uuid := 'd1000000-0000-0000-0000-000000000504';

  v_sale_paid_first jsonb;
  v_sale_completed_first jsonb;
  v_sale_walkin_owner jsonb;
  v_sale_walkin_manager jsonb;
  v_sale_walkin_fulfill_first jsonb;

  v_item_paid_first_id uuid;
  v_item_completed_first_id uuid;
  v_item_walkin_owner_id uuid;
  v_item_walkin_manager_id uuid;
  v_item_walkin_fulfill_first_id uuid;
  v_item_unfinished_id uuid;
  v_item_rule_timing_id uuid;
  v_item_mismatch_id uuid;

  v_payment_id uuid;
  v_result jsonb;
  v_count integer;
  v_sum numeric(12,2);
  v_forbidden boolean := false;
  v_cross_studio_blocked boolean := false;
  v_role_denied boolean := false;
  v_overlap_blocked boolean := false;
  v_dup_version_blocked boolean := false;
begin
  insert into public.users (id, email) values
    (v_owner_id, 'com01-owner@example.com'),
    (v_manager_id, 'com01-manager@example.com'),
    (v_frontdesk_l1_id, 'com01-frontdesk-l1@example.com'),
    (v_frontdesk_l2_id, 'com01-frontdesk-l2@example.com'),
    (v_instructor_user_id, 'com01-instructor@example.com'),
    (v_other_owner_id, 'com01-other-owner@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, contract_status, owner_id) values
    (v_studio_id, 'active', v_owner_id),
    (v_other_studio_id, 'active', v_other_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name, is_active) values
    (v_location_l1, v_studio_id, 'COM01-L1', true),
    (v_location_l2, v_studio_id, 'COM01-L2', true),
    (v_other_location_id, v_other_studio_id, 'COM01-Other', true)
  on conflict (id) do nothing;

  insert into public.staff_memberships (studio_id, user_id, location_id, role, is_active) values
    (v_studio_id, v_manager_id, null, 'manager', true),
    (v_studio_id, v_frontdesk_l1_id, v_location_l1, 'frontdesk', true),
    (v_studio_id, v_frontdesk_l2_id, v_location_l2, 'frontdesk', true),
    (v_studio_id, v_instructor_user_id, v_location_l1, 'instructor', true)
  on conflict do nothing;

  insert into public.studio_services (id, studio_id, name, price, currency, is_active) values
    (v_service_id, v_studio_id, 'COM01 Service', 100, 'SGD', true)
  on conflict (id) do nothing;

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values) values
    (v_studio_id, v_service_id, v_location_l1, true, true),
    (v_studio_id, v_service_id, v_location_l2, true, true)
  on conflict (service_id, location_id) do update set is_enabled = excluded.is_enabled;

  insert into public.salon_customers (id, studio_id, full_name, status, source, preferred_location_id)
  values (v_customer_id, v_studio_id, 'COM01 Customer', 'active', 'frontdesk', v_location_l1)
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, user_id, display_name, employment_status, is_active)
  values
    (v_employee_id, v_studio_id, null, 'COM01 Employee', 'active', true),
    (v_instructor_employee_id, v_studio_id, v_instructor_user_id, 'COM01 Instructor Employee', 'active', true)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.employee_locations where employee_id = v_employee_id and location_id = v_location_l1
  ) then
    insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
    values (v_employee_id, v_location_l1, v_studio_id, true, true);
  end if;

  if not exists (
    select 1 from public.employee_locations where employee_id = v_employee_id and location_id = v_location_l2
  ) then
    insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
    values (v_employee_id, v_location_l2, v_studio_id, false, true);
  end if;

  if not exists (
    select 1 from public.employee_locations where employee_id = v_instructor_employee_id and location_id = v_location_l1
  ) then
    insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
    values (v_instructor_employee_id, v_location_l1, v_studio_id, true, true);
  end if;

  insert into public.service_employees (studio_id, service_id, employee_id, is_active) values
    (v_studio_id, v_service_id, v_employee_id, true),
    (v_studio_id, v_service_id, v_instructor_employee_id, true)
  on conflict (service_id, employee_id) do update set is_active = excluded.is_active;

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
  ) values (
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
  );

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id,
    status, starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot, created_by, updated_by
  )
  values
    (
      v_appt_paid_first,
      v_studio_id,
      v_location_l1,
      v_customer_id,
      v_service_id,
      v_employee_id,
      'in_progress',
      now() + interval '3 hour',
      now() + interval '4 hour',
      now() + interval '2 hour 50 minute',
      now() + interval '4 hour 10 minute',
      'COM01 Service', 100, 'SGD', 60, 10, 10,
      'COM01 Employee', 'COM01-L1', v_owner_id, v_owner_id
    ),
    (
      v_appt_completed_first,
      v_studio_id,
      v_location_l1,
      v_customer_id,
      v_service_id,
      v_employee_id,
      'in_progress',
      now() + interval '5 hour',
      now() + interval '6 hour',
      now() + interval '4 hour 50 minute',
      now() + interval '6 hour 10 minute',
      'COM01 Service', 100, 'SGD', 60, 10, 10,
      'COM01 Employee', 'COM01-L1', v_owner_id, v_owner_id
    )
  on conflict (id) do nothing;

  -- Scenario A: pay first, complete later => only one earned entry.
  v_sale_paid_first := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 pay-first',
    p_idempotency_key := 'com01-payfirst-create',
    p_request_hash := encode(digest('com01-payfirst-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
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
    p_idempotency_key := 'com01-payfirst-item',
    p_request_hash := encode(digest('com01-payfirst-item', 'sha256'), 'hex')
  );
  v_item_paid_first_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_idempotency_key := 'com01-payfirst-lock',
    p_request_hash := encode(digest('com01-payfirst-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_sale_paid_first->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-PAYFIRST', 'single', 0
  )
  returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-payfirst',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_paid_first_id
    and entry_type = 'earned';

  if v_count <> 0 then
    raise exception 'expected no earned entry before appointment completion, got %', v_count;
  end if;

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_paid_first,
    p_to_status := 'completed'
  );

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_paid_first,
    p_to_status := 'completed'
  );

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-payfirst',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_paid_first_id
    and entry_type = 'earned';

  if v_count <> 1 then
    raise exception 'pay-first flow should create exactly one earned entry, got %', v_count;
  end if;

  -- Scenario B: complete first, pay later => only one earned entry.
  v_sale_completed_first := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 completed-first',
    p_idempotency_key := 'com01-completefirst-create',
    p_request_hash := encode(digest('com01-completefirst-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_completed_first->>'sale_id')::uuid,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := v_appt_completed_first,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := 'com01-completefirst-item',
    p_request_hash := encode(digest('com01-completefirst-item', 'sha256'), 'hex')
  );
  v_item_completed_first_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_completed_first->>'sale_id')::uuid,
    p_idempotency_key := 'com01-completefirst-lock',
    p_request_hash := encode(digest('com01-completefirst-lock', 'sha256'), 'hex')
  );

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_completed_first,
    p_to_status := 'completed'
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_completed_first_id
    and entry_type = 'earned';

  if v_count <> 0 then
    raise exception 'expected no earned entry before payment, got %', v_count;
  end if;

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_sale_completed_first->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-COMPLETEFIRST', 'single', 0
  )
  returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_sale_completed_first->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-completefirst',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_completed_first_id
    and entry_type = 'earned';

  if v_count <> 1 then
    raise exception 'complete-first flow should create exactly one earned entry, got %', v_count;
  end if;

  -- Scenario C: walk-in requires fulfilled evidence; owner allowed.
  v_sale_walkin_owner := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 walkin owner',
    p_idempotency_key := 'com01-walkin-owner-create',
    p_request_hash := encode(digest('com01-walkin-owner-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_owner->>'sale_id')::uuid,
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
    p_idempotency_key := 'com01-walkin-owner-item',
    p_request_hash := encode(digest('com01-walkin-owner-item', 'sha256'), 'hex')
  );
  v_item_walkin_owner_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_owner->>'sale_id')::uuid,
    p_idempotency_key := 'com01-walkin-owner-lock',
    p_request_hash := encode(digest('com01-walkin-owner-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_sale_walkin_owner->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-WALKIN-OWNER', 'single', 0
  )
  returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_sale_walkin_owner->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-walkin-owner',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_walkin_owner_id
    and entry_type = 'earned';

  if v_count <> 0 then
    raise exception 'walk-in should not earn before fulfilled_at, got %', v_count;
  end if;

  v_result := public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_walkin_owner_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'service delivered',
    p_idempotency_key := 'com01-walkin-owner-fulfilled',
    p_request_hash := encode(digest('com01-walkin-owner-fulfilled', 'sha256'), 'hex')
  );

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'walk-in fulfillment should succeed: %', v_result;
  end if;

  v_result := public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_walkin_owner_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'service delivered replay',
    p_idempotency_key := 'com01-walkin-owner-fulfilled',
    p_request_hash := encode(digest('com01-walkin-owner-fulfilled', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_walkin_owner_id
    and entry_type = 'earned';

  if v_count <> 1 then
    raise exception 'walk-in fulfill replay should not duplicate earned, got %', v_count;
  end if;

  select count(*)::integer into v_count
  from public.strong_audit_logs l
  where l.action = 'com01_walkin_fulfilled'
    and l.target_id = v_item_walkin_owner_id;

  if v_count <> 1 then
    raise exception 'walk-in fulfillment should write exactly one strong audit row, got %', v_count;
  end if;

  -- Scenario D: walk-in fulfill before payment, then pay later (contract: 先做后付).
  v_sale_walkin_fulfill_first := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 walkin fulfill first',
    p_idempotency_key := 'com01-walkin-fulfill-first-create',
    p_request_hash := encode(digest('com01-walkin-fulfill-first-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_fulfill_first->>'sale_id')::uuid,
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
    p_idempotency_key := 'com01-walkin-fulfill-first-item',
    p_request_hash := encode(digest('com01-walkin-fulfill-first-item', 'sha256'), 'hex')
  );
  v_item_walkin_fulfill_first_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_fulfill_first->>'sale_id')::uuid,
    p_idempotency_key := 'com01-walkin-fulfill-first-lock',
    p_request_hash := encode(digest('com01-walkin-fulfill-first-lock', 'sha256'), 'hex')
  );

  v_result := public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_walkin_fulfill_first_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'fulfill before payment',
    p_idempotency_key := 'com01-walkin-fulfill-first-fulfilled',
    p_request_hash := encode(digest('com01-walkin-fulfill-first-fulfilled', 'sha256'), 'hex')
  );

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'walk-in fulfill-first should succeed without payment: %', v_result;
  end if;

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_walkin_fulfill_first_id
    and entry_type = 'earned';

  if v_count <> 0 then
    raise exception 'walk-in fulfill-first should not earn before payment, got %', v_count;
  end if;

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_sale_walkin_fulfill_first->>'sale_id')::uuid, 100, 'SGD', 'cash', 'frontdesk', 'pos_sale', 'pending', 'COM01-WALKIN-FULFILL-FIRST', 'single', 0
  )
  returning id into v_payment_id;

  perform public.complete_pos_cash_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_fulfill_first->>'sale_id')::uuid,
    p_idempotency_key := 'com01-walkin-fulfill-first-pay',
    p_request_hash := encode(digest('com01-walkin-fulfill-first-pay', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_walkin_fulfill_first_id
    and entry_type = 'earned';

  if v_count <> 1 then
    raise exception 'walk-in fulfill-first should create exactly one earned after payment, got %', v_count;
  end if;

  -- Scenario E: manager role allowed.
  v_sale_walkin_manager := public.create_pos_sale_draft(
    p_actor_id := v_manager_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 walkin manager',
    p_idempotency_key := 'com01-walkin-manager-create',
    p_request_hash := encode(digest('com01-walkin-manager-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_manager_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_manager->>'sale_id')::uuid,
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
    p_idempotency_key := 'com01-walkin-manager-item',
    p_request_hash := encode(digest('com01-walkin-manager-item', 'sha256'), 'hex')
  );
  v_item_walkin_manager_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_manager_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_walkin_manager->>'sale_id')::uuid,
    p_idempotency_key := 'com01-walkin-manager-lock',
    p_request_hash := encode(digest('com01-walkin-manager-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_sale_walkin_manager->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-WALKIN-MANAGER', 'single', 0
  )
  returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_sale_walkin_manager->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-walkin-manager',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  perform public.com01_mark_pos_service_item_fulfilled(
    p_actor_id := v_manager_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_sale_item_id := v_item_walkin_manager_id,
    p_fulfilled_at := now(),
    p_fulfillment_note := 'manager fulfilled',
    p_idempotency_key := 'com01-walkin-manager-fulfilled',
    p_request_hash := encode(digest('com01-walkin-manager-fulfilled', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_walkin_manager_id
    and entry_type = 'earned';

  if v_count <> 1 then
    raise exception 'manager fulfillment should create earned entry, got %', v_count;
  end if;

  -- Role denied: instructor cannot mark fulfilled.
  begin
    perform public.com01_mark_pos_service_item_fulfilled(
      p_actor_id := v_instructor_user_id,
      p_actor_role := 'instructor',
      p_studio_id := v_studio_id,
      p_sale_item_id := v_item_walkin_manager_id,
      p_fulfilled_at := now(),
      p_fulfillment_note := 'instructor denied',
      p_idempotency_key := 'com01-role-denied',
      p_request_hash := encode(digest('com01-role-denied', 'sha256'), 'hex')
    );
  exception
    when sqlstate '42501' then
      v_role_denied := true;
  end;

  if not v_role_denied then
    raise exception 'expected instructor role to be denied for walk-in fulfillment';
  end if;

  -- Location boundary denied: frontdesk L2 cannot fulfill L1 item.
  v_result := public.create_pos_sale_draft(
    p_actor_id := v_frontdesk_l1_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 location boundary',
    p_idempotency_key := 'com01-location-create',
    p_request_hash := encode(digest('com01-location-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_frontdesk_l1_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
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
    p_idempotency_key := 'com01-location-item',
    p_request_hash := encode(digest('com01-location-item', 'sha256'), 'hex')
  );
  v_item_unfinished_id := (v_result->>'item_id')::uuid;

  begin
    perform public.com01_mark_pos_service_item_fulfilled(
      p_actor_id := v_frontdesk_l2_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_sale_item_id := v_item_unfinished_id,
      p_fulfilled_at := now(),
      p_fulfillment_note := 'cross location denied',
      p_idempotency_key := 'com01-location-denied',
      p_request_hash := encode(digest('com01-location-denied', 'sha256'), 'hex')
    );
  exception
    when sqlstate '42501' then
      v_forbidden := true;
  end;

  if not v_forbidden then
    raise exception 'expected cross-location frontdesk denial';
  end if;

  -- Cross-studio denied.
  begin
    perform public.com01_mark_pos_service_item_fulfilled(
      p_actor_id := v_owner_id,
      p_actor_role := 'owner',
      p_studio_id := v_other_studio_id,
      p_sale_item_id := v_item_walkin_owner_id,
      p_fulfilled_at := now(),
      p_fulfillment_note := 'cross studio denied',
      p_idempotency_key := 'com01-cross-studio-denied',
      p_request_hash := encode(digest('com01-cross-studio-denied', 'sha256'), 'hex')
    );
  exception
    when sqlstate 'P0002' then
      v_cross_studio_blocked := true;
  end;

  if not v_cross_studio_blocked then
    raise exception 'expected cross-studio denial (not found in studio scope)';
  end if;

  -- Refund reversal: partial then full; append-only and incremental.
  v_result := public.refund_pos_sale_items(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_items := jsonb_build_array(
      jsonb_build_object('item_id', v_item_paid_first_id, 'refund_amount', 30)
    ),
    p_reason := 'partial refund',
    p_idempotency_key := 'com01-refund-partial',
    p_request_hash := encode(digest('com01-refund-partial', 'sha256'), 'hex')
  );

  v_result := public.refund_pos_sale_items(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_items := jsonb_build_array(
      jsonb_build_object('item_id', v_item_paid_first_id, 'refund_amount', 30)
    ),
    p_reason := 'partial refund replay',
    p_idempotency_key := 'com01-refund-partial',
    p_request_hash := encode(digest('com01-refund-partial', 'sha256'), 'hex')
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where origin_entry_id = (
    select id
    from public.service_commission_entries
    where pos_sale_item_id = v_item_paid_first_id and entry_type = 'earned'
  )
    and entry_type = 'refund_reversal';

  if v_count <> 1 then
    raise exception 'partial refund replay should still have one reversal entry, got %', v_count;
  end if;

  perform public.refund_pos_sale_items(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_sale_paid_first->>'sale_id')::uuid,
    p_items := jsonb_build_array(
      jsonb_build_object('item_id', v_item_paid_first_id, 'refund_amount', 70)
    ),
    p_reason := 'full refund',
    p_idempotency_key := 'com01-refund-full',
    p_request_hash := encode(digest('com01-refund-full', 'sha256'), 'hex')
  );

  select count(*)::integer, round(coalesce(sum(amount), 0), 2)
    into v_count, v_sum
  from public.service_commission_entries
  where origin_entry_id = (
    select id
    from public.service_commission_entries
    where pos_sale_item_id = v_item_paid_first_id and entry_type = 'earned'
  )
    and entry_type = 'refund_reversal';

  if v_count <> 2 then
    raise exception 'partial+full refund should create two reversal entries, got %', v_count;
  end if;

  if v_sum <> -10.00 then
    raise exception 'reversal sum should equal -earned amount (-10.00), got %', v_sum;
  end if;

  -- Rule conflict guards: overlap and duplicate scope/version must be rejected.
  begin
    insert into public.employee_service_commission_rules (
      studio_id, location_id, employee_id, service_id,
      commission_type, percent_rate, currency, rule_version,
      effective_from, effective_until, created_by
    ) values (
      v_studio_id, null, null, v_service_id,
      'percent', 12, 'SGD', 99,
      now() - interval '30 minutes', now() + interval '30 minutes', v_owner_id
    );
  exception
    when sqlstate '23P01' then
      v_overlap_blocked := true;
  end;

  if not v_overlap_blocked then
    raise exception 'expected overlapping active commission rules to be rejected';
  end if;

  begin
    insert into public.employee_service_commission_rules (
      studio_id, location_id, employee_id, service_id,
      commission_type, percent_rate, currency, rule_version,
      effective_from, effective_until, created_by
    ) values (
      v_studio_id, null, null, v_service_id,
      'percent', 15, 'SGD', 1,
      now() + interval '1 day', now() + interval '2 day', v_owner_id
    );
  exception
    when sqlstate '23505' then
      v_dup_version_blocked := true;
  end;

  if not v_dup_version_blocked then
    raise exception 'expected duplicate scope/version commission rules to be rejected';
  end if;

  -- Rule timing: pay first (old paid_at), complete later -> should pick later (new) rule.
  insert into public.employee_service_commission_rules (
    studio_id, location_id, employee_id, service_id,
    commission_type, percent_rate, currency, rule_version,
    effective_from, effective_until, created_by
  ) values (
    v_studio_id, v_location_l1, v_employee_id, v_service_id,
    'percent', 20, 'SGD', 2,
    now() - interval '10 minutes', null, v_owner_id
  );

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id,
    status, starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot, created_by, updated_by
  ) values (
    v_appt_rule_timing,
    v_studio_id,
    v_location_l1,
    v_customer_id,
    v_service_id,
    v_employee_id,
    'in_progress',
    now() + interval '7 hour',
    now() + interval '8 hour',
    now() + interval '6 hour 50 minute',
    now() + interval '8 hour 10 minute',
    'COM01 Service', 100, 'SGD', 60, 10, 10,
    'COM01 Employee', 'COM01-L1', v_owner_id, v_owner_id
  ) on conflict (id) do nothing;

  v_result := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 rule timing',
    p_idempotency_key := 'com01-rule-time-create',
    p_request_hash := encode(digest('com01-rule-time-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := v_appt_rule_timing,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := 'com01-rule-time-item',
    p_request_hash := encode(digest('com01-rule-time-item', 'sha256'), 'hex')
  );
  v_item_rule_timing_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_idempotency_key := 'com01-rule-time-lock',
    p_request_hash := encode(digest('com01-rule-time-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_result->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-RULE-TIME', 'single', 0
  ) returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-rule-time',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  update public.payments
  set paid_at = now() - interval '2 hour'
  where id = v_payment_id;

  update public.pos_sales
  set paid_at = now() - interval '2 hour'
  where id = (select sale_id from public.pos_sale_items where id = v_item_rule_timing_id);

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_rule_timing,
    p_to_status := 'completed'
  );

  if (
    select rule_version
    from public.service_commission_entries
    where pos_sale_item_id = v_item_rule_timing_id and entry_type = 'earned'
    limit 1
  ) <> 2 then
    raise exception 'appointment pay-first should resolve newer rule version by completed_at';
  end if;

  -- Appointment mismatch: item employee/service differs from appointment -> no earned entry.
  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id,
    status, starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot, created_by, updated_by
  ) values (
    v_appt_mismatch,
    v_studio_id,
    v_location_l1,
    v_customer_id,
    v_service_id,
    v_instructor_employee_id,
    'in_progress',
    now() + interval '9 hour',
    now() + interval '10 hour',
    now() + interval '8 hour 50 minute',
    now() + interval '10 hour 10 minute',
    'COM01 Service', 100, 'SGD', 60, 10, 10,
    'COM01 Instructor Employee', 'COM01-L1', v_owner_id, v_owner_id
  ) on conflict (id) do nothing;

  v_result := public.create_pos_sale_draft(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_location_id := v_location_l1,
    p_salon_customer_id := v_customer_id,
    p_note := 'COM01 appointment mismatch',
    p_idempotency_key := 'com01-mismatch-create',
    p_request_hash := encode(digest('com01-mismatch-create', 'sha256'), 'hex')
  );

  v_result := public.upsert_pos_sale_item(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_item_id := null,
    p_line_number := 1,
    p_item_type := 'service',
    p_service_id := v_service_id,
    p_product_id := null,
    p_package_id := null,
    p_salon_appointment_id := v_appt_mismatch,
    p_employee_id := v_employee_id,
    p_item_name_snapshot := 'COM01 Service',
    p_item_currency_snapshot := 'SGD',
    p_quantity := 1,
    p_unit_price_amount := 100,
    p_discount_amount := 0,
    p_tax_amount := 0,
    p_idempotency_key := 'com01-mismatch-item',
    p_request_hash := encode(digest('com01-mismatch-item', 'sha256'), 'hex')
  );
  v_item_mismatch_id := (v_result->>'item_id')::uuid;

  perform public.lock_pos_sale(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_studio_id := v_studio_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_idempotency_key := 'com01-mismatch-lock',
    p_request_hash := encode(digest('com01-mismatch-lock', 'sha256'), 'hex')
  );

  insert into public.payments (
    studio_id, location_id, pos_sale_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_studio_id, v_location_l1, (v_result->>'sale_id')::uuid, 100, 'SGD', 'hitpay', 'frontdesk', 'pos_sale', 'pending', 'COM01-MISMATCH', 'single', 0
  ) returning id into v_payment_id;

  perform public.complete_pos_hitpay_sale(
    p_studio_id := v_studio_id,
    p_payment_id := v_payment_id,
    p_sale_id := (v_result->>'sale_id')::uuid,
    p_provider_event_id := null,
    p_gateway_payment_id := 'hp-com01-mismatch',
    p_gateway_status := 'succeeded',
    p_gateway_payload := '{}',
    p_verified_by := v_owner_id
  );

  perform public.transition_salon_appointment_status(
    p_actor_id := v_owner_id,
    p_actor_role := 'owner',
    p_actor_employee_id := null,
    p_studio_id := v_studio_id,
    p_appointment_id := v_appt_mismatch,
    p_to_status := 'completed'
  );

  select count(*)::integer into v_count
  from public.service_commission_entries
  where pos_sale_item_id = v_item_mismatch_id
    and entry_type = 'earned';

  if v_count <> 0 then
    raise exception 'appointment/item mismatch should not produce earned entry, got %', v_count;
  end if;

  -- Ensure earned entry snapshot fields are complete.
  if exists (
    select 1
    from public.service_commission_entries e
    where e.entry_type = 'earned'
      and (
        e.studio_id is null
        or e.location_id is null
        or e.employee_id is null
        or e.service_id is null
        or e.pos_sale_item_id is null
        or e.amount is null
        or e.currency is null
        or e.rule_version is null
        or e.rule_snapshot = '{}'::jsonb
      )
  ) then
    raise exception 'earned entry required snapshot fields missing';
  end if;
end;
$$;

select 'com01_commission_ok' as result;
