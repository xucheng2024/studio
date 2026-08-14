\set ON_ERROR_STOP on

begin;

do $$
declare
  v_studio uuid := '11000000-0000-0000-0000-000000000001';
  v_location uuid := '11000000-0000-0000-0000-000000000011';
  v_service uuid := '11000000-0000-0000-0000-000000000021';
  v_employee uuid := '11000000-0000-0000-0000-000000000031';
  v_customer_user uuid := '11000000-0000-0000-0000-000000000101';
  v_customer uuid := '11000000-0000-0000-0000-000000000201';
  v_terms uuid := '11000000-0000-0000-0000-000000000301';
  v_package uuid := '11000000-0000-0000-0000-000000000401';
  v_client_package uuid := '11000000-0000-0000-0000-000000000402';

  v_create_pkg jsonb;
  v_create_online jsonb;
  v_pkg_appointment uuid;
  v_online_appointment uuid;
  v_package_settlement jsonb;
  v_online_prepare jsonb;
  v_online_payment uuid;
  v_settlement record;
  v_pkg_settlement record;
  v_appt_status text;
  v_appt_expires timestamptz;
  v_return_ledger uuid;
begin
  insert into public.studios (id, contract_status) values (v_studio, 'active');

  insert into public.users (id, email)
  values (v_customer_user, 'phase2@example.com');

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location, v_studio, 'APT04 P2 Location', true);

  insert into public.studio_services (
    id,
    studio_id,
    name,
    price,
    currency,
    is_active,
    default_duration_minutes,
    default_prep_minutes,
    default_buffer_minutes
  )
  values (v_service, v_studio, 'APT04 P2 Service', 120, 'SGD', true, 60, 0, 0);

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled)
  values (v_studio, v_service, v_location, true);

  insert into public.employees (id, studio_id, display_name, employment_status, is_active)
  values (v_employee, v_studio, 'APT04 P2 Employee', 'active', true);

  insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
  values (v_employee, v_location, v_studio, true);

  insert into public.service_employees (studio_id, service_id, employee_id, is_active)
  values (v_studio, v_service, v_employee, true);

  insert into public.location_operating_hours (studio_id, location_id, weekday, opens_at, closes_at, is_closed)
  values (v_studio, v_location, 1, '09:00', '21:00', false);

  insert into public.employee_working_hours (studio_id, employee_id, location_id, weekday, starts_at, ends_at, is_active)
  values (v_studio, v_employee, v_location, 1, '09:00', '21:00', true);

  insert into public.salon_customers (id, studio_id, user_id, full_name, status, source)
  values (v_customer, v_studio, v_customer_user, 'Phase2 Customer', 'active', 'online');

  insert into public.salon_terms_versions (id, studio_id, version_label, content_hash, content_snapshot, is_active)
  values (v_terms, v_studio, 'v1', 'apt04-phase2-hash-v1', '{"title":"Terms"}'::jsonb, true);

  insert into public.packages (id, studio_id, name, credits, price, location_id, type, is_active)
  values (v_package, v_studio, 'P2 Pack', 10, 100, v_location, 'class_pack', true);

  insert into public.client_packages (
    id,
    client_id,
    package_id,
    credits_left,
    expiry_date,
    package_name_snapshot,
    package_credits_snapshot,
    package_expiry_days_snapshot
  )
  values (
    v_client_package,
    v_customer_user,
    v_package,
    3,
    now() + interval '30 days',
    'P2 Pack',
    10,
    30
  );

  v_create_pkg := public.create_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_location_id := v_location,
    p_salon_customer_id := v_customer,
    p_service_id := v_service,
    p_employee_id := v_employee,
    p_starts_at := '2026-08-17T10:00:00+08:00'::timestamptz,
    p_resource_ids := null,
    p_terms_version_id := v_terms,
    p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
    p_terms_acceptance_channel := 'self_booking_web',
    p_terms_acceptance_method := 'checkbox',
    p_terms_recorded_by := v_customer_user
  );

  if coalesce((v_create_pkg ->> 'ok')::boolean, false) is not true then
    raise exception 'phase2 package create failed: %', v_create_pkg;
  end if;

  v_pkg_appointment := (v_create_pkg ->> 'appointment_id')::uuid;

  v_package_settlement := public.apt04_finalize_package_settlement(
    p_studio_id := v_studio,
    p_appointment_id := v_pkg_appointment,
    p_actor_id := v_customer_user,
    p_idempotency_key_id := null
  );

  if coalesce((v_package_settlement ->> 'ok')::boolean, false) is not true then
    raise exception 'phase2 package settlement failed: %', v_package_settlement;
  end if;

  select status, expires_at into v_appt_status, v_appt_expires
  from public.salon_appointments
  where id = v_pkg_appointment;

  if v_appt_status <> 'confirmed' or v_appt_expires is not null then
    raise exception 'package settlement must confirm appointment and clear expiry, got status %, expires %', v_appt_status, v_appt_expires;
  end if;

  select * into v_pkg_settlement
  from public.salon_appointment_settlements
  where appointment_id = v_pkg_appointment;

  if not found then
    raise exception 'missing package settlement';
  end if;

  if v_pkg_settlement.status <> 'package_consumed' or v_pkg_settlement.consume_ledger_entry_id is null then
    raise exception 'invalid package settlement row: %', to_jsonb(v_pkg_settlement);
  end if;

  perform public.cancel_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_appointment_id := v_pkg_appointment,
    p_reason := 'customer_cancelled'
  );

  select return_ledger_entry_id into v_return_ledger
  from public.salon_appointment_settlements
  where appointment_id = v_pkg_appointment;

  if v_return_ledger is null then
    raise exception 'cancel must return package credit in same DB chain';
  end if;

  v_create_online := public.create_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_location_id := v_location,
    p_salon_customer_id := v_customer,
    p_service_id := v_service,
    p_employee_id := v_employee,
    p_starts_at := '2026-08-17T12:00:00+08:00'::timestamptz,
    p_resource_ids := null,
    p_terms_version_id := v_terms,
    p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
    p_terms_acceptance_channel := 'self_booking_web',
    p_terms_acceptance_method := 'checkbox',
    p_terms_recorded_by := v_customer_user
  );

  if coalesce((v_create_online ->> 'ok')::boolean, false) is not true then
    raise exception 'phase2 online create failed: %', v_create_online;
  end if;

  v_online_appointment := (v_create_online ->> 'appointment_id')::uuid;

  v_online_prepare := public.apt04_prepare_online_settlement(
    p_actor_id := v_customer_user,
    p_studio_id := v_studio,
    p_appointment_id := v_online_appointment,
    p_settlement_mode := 'online_deposit'
  );

  if coalesce((v_online_prepare ->> 'ok')::boolean, false) is not true then
    raise exception 'phase2 online prepare failed: %', v_online_prepare;
  end if;

  v_online_payment := nullif(v_online_prepare ->> 'payment_id', '')::uuid;
  if v_online_payment is null then
    raise exception 'online prepare must return payment id';
  end if;

  update public.payments
  set status = 'paid',
      verified_at = now(),
      verified_by = v_customer_user
  where id = v_online_payment;

  select * into v_settlement
  from public.salon_appointment_settlements
  where appointment_id = v_online_appointment;

  if not found then
    raise exception 'missing online settlement';
  end if;

  if v_settlement.status <> 'deposit_paid' then
    raise exception 'expected deposit_paid after paid payment, got %', v_settlement.status;
  end if;

  select status, expires_at into v_appt_status, v_appt_expires
  from public.salon_appointments
  where id = v_online_appointment;

  if v_appt_status <> 'confirmed' or v_appt_expires is not null then
    raise exception 'online paid must confirm appointment and clear expiry, got status %, expires %', v_appt_status, v_appt_expires;
  end if;

  v_create_online := public.create_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_location_id := v_location,
    p_salon_customer_id := v_customer,
    p_service_id := v_service,
    p_employee_id := v_employee,
    p_starts_at := '2026-08-17T14:00:00+08:00'::timestamptz,
    p_resource_ids := null,
    p_terms_version_id := v_terms,
    p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
    p_terms_acceptance_channel := 'self_booking_web',
    p_terms_acceptance_method := 'checkbox',
    p_terms_recorded_by := v_customer_user
  );
  v_online_appointment := (v_create_online ->> 'appointment_id')::uuid;

  v_online_prepare := public.apt04_prepare_online_settlement(
    p_actor_id := v_customer_user,
    p_studio_id := v_studio,
    p_appointment_id := v_online_appointment,
    p_settlement_mode := 'online_deposit'
  );
  v_online_payment := nullif(v_online_prepare ->> 'payment_id', '')::uuid;

  perform public.apt04_mark_settlement_terminal(
    p_studio_id := v_studio,
    p_payment_id := v_online_payment,
    p_next_status := 'payment_failed',
    p_actor_role := 'test_terminal',
    p_actor_id := v_customer_user
  );

  begin
    update public.payments
    set status = 'paid',
        verified_at = now(),
        verified_by = v_customer_user
    where id = v_online_payment;
    raise exception 'terminal settlement should reject paid transition';
  exception
    when others then
      if sqlstate = '23514' then
        null;
      else
        raise;
      end if;
  end;
end;
$$;

rollback;

select 'verify_apt04_phase2_settlement: ok' as result;
