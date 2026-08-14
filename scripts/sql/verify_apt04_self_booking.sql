\set ON_ERROR_STOP on

begin;

do $$
declare
  v_studio uuid := '10000000-0000-0000-0000-000000000001';
  v_location uuid := '10000000-0000-0000-0000-000000000011';
  v_service uuid := '10000000-0000-0000-0000-000000000021';
  v_employee uuid := '10000000-0000-0000-0000-000000000031';
  v_customer_user uuid := '10000000-0000-0000-0000-000000000101';
  v_other_user uuid := '10000000-0000-0000-0000-000000000102';
  v_customer_self uuid := '10000000-0000-0000-0000-000000000201';
  v_customer_other uuid := '10000000-0000-0000-0000-000000000202';
  v_terms uuid := '10000000-0000-0000-0000-000000000301';

  v_key_create_self uuid;
  v_claim_create_self uuid;
  v_key_create_other uuid;
  v_claim_create_other uuid;
  v_key_create_other_owner uuid;
  v_claim_create_other_owner uuid;
  v_key_cancel_self uuid;
  v_claim_cancel_self uuid;
  v_key_cancel_other uuid;
  v_claim_cancel_other uuid;

  v_create_self jsonb;
  v_create_other jsonb;
  v_create_other_owner jsonb;
  v_cancel_self jsonb;
begin
  insert into public.studios (id, contract_status) values (v_studio, 'active');

  insert into public.users (id, email)
  values
    (v_customer_user, 'self@example.com'),
    (v_other_user, 'other@example.com');

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location, v_studio, 'APT04 Location', true);

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
  values (v_service, v_studio, 'APT04 Service', 120, 'SGD', true, 60, 0, 0);

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled)
  values (v_studio, v_service, v_location, true);

  insert into public.employees (id, studio_id, display_name, employment_status, is_active)
  values (v_employee, v_studio, 'APT04 Employee', 'active', true);

  insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
  values (v_employee, v_location, v_studio, true);

  insert into public.service_employees (studio_id, service_id, employee_id, is_active)
  values (v_studio, v_service, v_employee, true);

  insert into public.location_operating_hours (studio_id, location_id, weekday, opens_at, closes_at, is_closed)
  values (v_studio, v_location, 1, '09:00', '21:00', false);

  insert into public.employee_working_hours (studio_id, employee_id, location_id, weekday, starts_at, ends_at, is_active)
  values (v_studio, v_employee, v_location, 1, '09:00', '21:00', true);

  insert into public.salon_customers (id, studio_id, user_id, full_name, status, source)
  values
    (v_customer_self, v_studio, v_customer_user, 'Self Customer', 'active', 'online'),
    (v_customer_other, v_studio, v_other_user, 'Other Customer', 'active', 'online');

  insert into public.salon_terms_versions (id, studio_id, version_label, content_hash, content_snapshot, is_active)
  values (v_terms, v_studio, 'v1', 'apt04-hash-v1', '{"title":"Terms"}'::jsonb, true);

  -- self create: customer can create own appointment
  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash)
  values (v_studio, 'salon_appointment:create', 'apt04-create-self', 'h1')
  returning id, claim_token into v_key_create_self, v_claim_create_self;

  v_create_self := public.create_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_location_id := v_location,
    p_salon_customer_id := v_customer_self,
    p_service_id := v_service,
    p_employee_id := v_employee,
    p_starts_at := '2026-08-17T10:00:00+08:00'::timestamptz,
    p_resource_ids := null,
    p_terms_version_id := v_terms,
    p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
    p_terms_acceptance_channel := 'self_booking_web',
    p_terms_acceptance_method := 'checkbox',
    p_terms_recorded_by := v_customer_user,
    p_idempotency_key_id := v_key_create_self,
    p_idempotency_claim_token := v_claim_create_self
  );

  if coalesce((v_create_self ->> 'ok')::boolean, false) is not true then
    raise exception 'expected self create success, got: %', v_create_self;
  end if;

  -- self create with another customer's id: must fail
  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash)
  values (v_studio, 'salon_appointment:create', 'apt04-create-other', 'h2')
  returning id, claim_token into v_key_create_other, v_claim_create_other;

  begin
    perform public.create_salon_appointment(
      p_actor_id := v_customer_user,
      p_actor_role := 'customer',
      p_studio_id := v_studio,
      p_location_id := v_location,
      p_salon_customer_id := v_customer_other,
      p_service_id := v_service,
      p_employee_id := v_employee,
      p_starts_at := '2026-08-17T11:30:00+08:00'::timestamptz,
      p_resource_ids := null,
      p_terms_version_id := v_terms,
      p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
      p_terms_acceptance_channel := 'self_booking_web',
      p_terms_acceptance_method := 'checkbox',
      p_terms_recorded_by := v_customer_user,
      p_idempotency_key_id := v_key_create_other,
      p_idempotency_claim_token := v_claim_create_other
    );
    raise exception 'expected create as other customer to fail';
  exception
    when insufficient_privilege then null;
  end;

  -- create appointment for other customer via frontdesk (setup)
  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash)
  values (v_studio, 'salon_appointment:create', 'apt04-create-other-owner', 'h3')
  returning id, claim_token into v_key_create_other_owner, v_claim_create_other_owner;

  v_create_other_owner := public.create_salon_appointment(
    p_actor_id := v_other_user,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio,
    p_location_id := v_location,
    p_salon_customer_id := v_customer_other,
    p_service_id := v_service,
    p_employee_id := v_employee,
    p_starts_at := '2026-08-17T12:30:00+08:00'::timestamptz,
    p_resource_ids := null,
    p_terms_version_id := v_terms,
    p_terms_accepted_at := '2026-08-15T10:00:00+08:00'::timestamptz,
    p_terms_acceptance_channel := 'staff_assisted',
    p_terms_acceptance_method := 'verbal',
    p_terms_recorded_by := v_other_user,
    p_idempotency_key_id := v_key_create_other_owner,
    p_idempotency_claim_token := v_claim_create_other_owner
  );

  if coalesce((v_create_other_owner ->> 'ok')::boolean, false) is not true then
    raise exception 'expected setup create success, got: %', v_create_other_owner;
  end if;

  -- self cancel own appointment: should succeed
  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash)
  values (v_studio, 'salon_appointment:cancel', 'apt04-cancel-self', 'h4')
  returning id, claim_token into v_key_cancel_self, v_claim_cancel_self;

  v_cancel_self := public.cancel_salon_appointment(
    p_actor_id := v_customer_user,
    p_actor_role := 'customer',
    p_studio_id := v_studio,
    p_appointment_id := (v_create_self ->> 'appointment_id')::uuid,
    p_reason := 'customer_cancelled',
    p_idempotency_key_id := v_key_cancel_self,
    p_idempotency_claim_token := v_claim_cancel_self
  );

  if coalesce((v_cancel_self ->> 'ok')::boolean, false) is not true then
    raise exception 'expected self cancel success, got: %', v_cancel_self;
  end if;

  -- self cancel another customer's appointment: must fail
  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash)
  values (v_studio, 'salon_appointment:cancel', 'apt04-cancel-other', 'h5')
  returning id, claim_token into v_key_cancel_other, v_claim_cancel_other;

  begin
    perform public.cancel_salon_appointment(
      p_actor_id := v_customer_user,
      p_actor_role := 'customer',
      p_studio_id := v_studio,
      p_appointment_id := (v_create_other_owner ->> 'appointment_id')::uuid,
      p_reason := 'malicious_cancel',
      p_idempotency_key_id := v_key_cancel_other,
      p_idempotency_claim_token := v_claim_cancel_other
    );
    raise exception 'expected cancel for other customer to fail';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;

select 'verify_apt04_self_booking: ok' as result;
