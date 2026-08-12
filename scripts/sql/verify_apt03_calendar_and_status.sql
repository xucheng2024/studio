\set ON_ERROR_STOP on

truncate table
  public.strong_audit_logs,
  public.salon_terms_acceptances,
  public.salon_appointment_status_history,
  public.salon_appointment_resources,
  public.salon_appointments,
  public.salon_resources,
  public.service_resource_requirements,
  public.service_employees,
  public.employee_availability_exceptions,
  public.employee_working_hours,
  public.employee_locations,
  public.employees,
  public.salon_customers,
  public.service_locations,
  public.studio_services,
  public.locations,
  public.studios,
  public.users,
  public.business_idempotency_keys
restart identity cascade;

insert into public.users (id, email) values
  ('90000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('90000000-0000-0000-0000-000000000002', 'frontdesk@example.com')
on conflict (id) do nothing;

insert into public.studios (id, contract_status)
values ('00000000-0000-0000-0000-000000000001', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'L1', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'L2', true)
on conflict (id) do nothing;

insert into public.studio_services (id, studio_id, name, price, currency, is_active)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Service A', 100, 'SGD', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Service B', 120, 'SGD', true)
on conflict (id) do nothing;

insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', true, true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', true, true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true, true)
on conflict (service_id, location_id) do update set is_enabled = excluded.is_enabled;

insert into public.salon_customers (id, studio_id, full_name, status, source)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Customer A', 'active', 'frontdesk'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Customer B', 'active', 'frontdesk')
on conflict (id) do nothing;

insert into public.employees (id, studio_id, display_name, employment_status, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Alice', 'active', true),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Bob', 'active', true)
on conflict (id) do nothing;

insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true, true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true, true);

insert into public.service_employees (studio_id, service_id, employee_id, is_active)
values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', true)
on conflict (service_id, employee_id) do update set is_active = excluded.is_active;

insert into public.salon_resources (id, studio_id, location_id, name, resource_type, capacity, is_active)
values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Room 1', 'room', 1, true),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Room 2', 'room', 1, true)
on conflict (id) do nothing;

insert into public.salon_appointments (
  id, studio_id, location_id, salon_customer_id, service_id, employee_id,
  status, starts_at, ends_at, occupied_from, occupied_until, expires_at,
  service_title_snapshot, service_price_snapshot, service_currency_snapshot,
  service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
  employee_name_snapshot, location_name_snapshot, created_by, updated_by
)
values
  (
    '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
    'confirmed', '2026-09-01 01:00:00+00', '2026-09-01 02:00:00+00', '2026-09-01 01:00:00+00', '2026-09-01 02:00:00+00', null,
    'Service A', 100, 'SGD', 60, 0, 0,
    'Alice', 'L1', '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'
  ),
  (
    '50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
    'pending', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', '2026-09-01 16:15:00+00',
    'Service A', 100, 'SGD', 60, 0, 0,
    'Bob', 'L1', '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'
  ),
  (
    '50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
    'in_progress', '2026-09-02 03:00:00+00', '2026-09-02 04:00:00+00', '2026-09-02 03:00:00+00', '2026-09-02 04:00:00+00', null,
    'Service B', 120, 'SGD', 60, 0, 0,
    'Alice', 'L1', '90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'
  );

insert into public.salon_appointment_resources (
  appointment_id, resource_id, studio_id, location_id, occupied_from, occupied_until, is_active
)
values
  ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-09-01 01:00:00+00', '2026-09-01 02:00:00+00', true),
  ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', true),
  ('50000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-09-02 03:00:00+00', '2026-09-02 04:00:00+00', true);

insert into public.salon_appointment_status_history (
  appointment_id, studio_id, from_status, to_status, actor, actor_id, actor_role, reason
)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', null, 'confirmed', 'user', '90000000-0000-0000-0000-000000000001', 'owner', 'seed'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', null, 'pending', 'user', '90000000-0000-0000-0000-000000000001', 'owner', 'seed'),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'checked_in', 'in_progress', 'user', '90000000-0000-0000-0000-000000000001', 'owner', 'seed');

do $$
declare
  v_rows integer;
  v_claim jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_cancel_first jsonb;
  v_cancel_replay jsonb;
  v_cancel_snapshot jsonb;
  v_before_history integer;
  v_after_history integer;
  v_before_audit integer;
  v_after_audit integer;
  v_hash text;
begin
  -- Day/week boundary: [start, end)
  select count(*) into v_rows
  from public.list_salon_appointments_for_calendar(
    'owner',
    null,
    '00000000-0000-0000-0000-000000000001',
    '2026-09-01 00:00:00+08',
    '2026-09-02 00:00:00+08',
    null,
    null,
    null,
    null
  );

  if v_rows <> 1 then
    raise exception 'expected day boundary count=1, got %', v_rows;
  end if;

  select count(*) into v_rows
  from public.list_salon_appointments_for_calendar(
    'owner',
    null,
    '00000000-0000-0000-0000-000000000001',
    '2026-09-01 00:00:00+08',
    '2026-09-08 00:00:00+08',
    null,
    '30000000-0000-0000-0000-000000000001',
    null,
    array['confirmed','in_progress']
  );

  if v_rows <> 2 then
    raise exception 'expected employee/status filtered count=2, got %', v_rows;
  end if;

  -- confirmed -> checked_in (legal) with idempotency fencing
  select count(*) into v_before_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000001';
  select count(*) into v_before_audit from public.strong_audit_logs;

  v_hash := encode(digest('apt03-transition-1', 'sha256'), 'hex');
  select public.claim_business_idempotency_key(
    '00000000-0000-0000-0000-000000000001',
    'salon_appointment:status_transition',
    'apt03-status-1',
    v_hash,
    300
  ) into v_claim;

  v_result := public.transition_salon_appointment_status(
    '90000000-0000-0000-0000-000000000001',
    'owner',
    null,
    '00000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'checked_in',
    null,
    (v_claim->>'id')::uuid,
    (v_claim->>'claimToken')::uuid
  );

  if (v_result->>'status') <> 'checked_in' then
    raise exception 'expected checked_in status, got %', v_result;
  end if;

  select count(*) into v_after_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000001';
  select count(*) into v_after_audit from public.strong_audit_logs;

  if v_after_history <> v_before_history + 1 then
    raise exception 'expected exactly one new history row for checked_in';
  end if;
  if v_after_audit <> v_before_audit + 1 then
    raise exception 'expected exactly one new audit row for checked_in';
  end if;

  -- illegal transition checked_in -> completed should fail
  begin
    perform public.transition_salon_appointment_status(
      '90000000-0000-0000-0000-000000000001',
      'owner',
      null,
      '00000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'completed',
      null,
      null,
      null
    );
    raise exception 'expected illegal transition to fail';
  exception when sqlstate '23514' then
    null;
  end;

  -- in_progress -> completed releases resources
  select count(*) into v_before_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000003';
  select count(*) into v_before_audit from public.strong_audit_logs;

  v_hash := encode(digest('apt03-transition-2', 'sha256'), 'hex');
  select public.claim_business_idempotency_key(
    '00000000-0000-0000-0000-000000000001',
    'salon_appointment:status_transition',
    'apt03-status-2',
    v_hash,
    300
  ) into v_claim;

  v_result := public.transition_salon_appointment_status(
    '90000000-0000-0000-0000-000000000001',
    'owner',
    null,
    '00000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000003',
    'completed',
    null,
    (v_claim->>'id')::uuid,
    (v_claim->>'claimToken')::uuid
  );

  if (v_result->>'status') <> 'completed' then
    raise exception 'expected completed status, got %', v_result;
  end if;

  if coalesce((v_result->>'released_resources')::integer, 0) < 1 then
    raise exception 'expected resources released on completed, got %', v_result;
  end if;

  select count(*) into v_after_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000003';
  select count(*) into v_after_audit from public.strong_audit_logs;

  if v_after_history <> v_before_history + 1 then
    raise exception 'expected exactly one new history row for completed';
  end if;
  if v_after_audit <> v_before_audit + 1 then
    raise exception 'expected exactly one new audit row for completed';
  end if;

  if exists (
    select 1 from public.salon_appointment_resources
    where appointment_id = '50000000-0000-0000-0000-000000000003'
      and is_active
  ) then
    raise exception 'expected no active resources after completed';
  end if;

  -- idempotent replay must not duplicate history/audit
  select public.claim_business_idempotency_key(
    '00000000-0000-0000-0000-000000000001',
    'salon_appointment:status_transition',
    'apt03-status-2',
    v_hash,
    300
  ) into v_replay;

  if (v_replay->>'outcome') <> 'already_completed' then
    raise exception 'expected already_completed replay, got %', v_replay;
  end if;

  if (v_replay->'result') is null then
    raise exception 'expected replay result snapshot';
  end if;

  if (select count(*) from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000003') <> v_after_history then
    raise exception 'idempotent replay duplicated history rows';
  end if;

  if (select count(*) from public.strong_audit_logs) <> v_after_audit then
    raise exception 'idempotent replay duplicated audit rows';
  end if;

  -- pending -> cancelled with idempotent replay payload equality
  select count(*) into v_before_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000002';
  select count(*) into v_before_audit from public.strong_audit_logs;

  v_hash := encode(digest('apt03-transition-cancel-1', 'sha256'), 'hex');
  select public.claim_business_idempotency_key(
    '00000000-0000-0000-0000-000000000001',
    'salon_appointment:status_transition',
    'apt03-status-cancel-1',
    v_hash,
    300
  ) into v_claim;

  v_cancel_first := public.transition_salon_appointment_status(
    '90000000-0000-0000-0000-000000000001',
    'frontdesk',
    null,
    '00000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002',
    'cancelled',
    'customer_request',
    (v_claim->>'id')::uuid,
    (v_claim->>'claimToken')::uuid
  );

  if (v_cancel_first->>'status') <> 'cancelled' then
    raise exception 'expected cancelled status, got %', v_cancel_first;
  end if;

  if (v_cancel_first->>'from_status') <> 'pending' then
    raise exception 'expected cancelled payload from_status=pending, got %', v_cancel_first;
  end if;

  if (v_cancel_first->>'to_status') <> 'cancelled' then
    raise exception 'expected cancelled payload to_status=cancelled, got %', v_cancel_first;
  end if;

  if coalesce((v_cancel_first->>'already_in_target')::boolean, false) is distinct from false then
    raise exception 'expected first cancelled payload already_in_target=false, got %', v_cancel_first;
  end if;

  if exists (
    select 1 from public.salon_appointment_resources
    where appointment_id = '50000000-0000-0000-0000-000000000002'
      and is_active
  ) then
    raise exception 'expected no active resources after cancellation';
  end if;

  select count(*) into v_after_history from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000002';
  select count(*) into v_after_audit from public.strong_audit_logs;

  if v_after_history <> v_before_history + 1 then
    raise exception 'expected exactly one new history row for cancelled transition';
  end if;
  if v_after_audit <> v_before_audit + 1 then
    raise exception 'expected exactly one new audit row for cancelled transition';
  end if;

  select public.claim_business_idempotency_key(
    '00000000-0000-0000-0000-000000000001',
    'salon_appointment:status_transition',
    'apt03-status-cancel-1',
    v_hash,
    300
  ) into v_cancel_replay;

  if (v_cancel_replay->>'outcome') <> 'already_completed' then
    raise exception 'expected cancelled replay outcome already_completed, got %', v_cancel_replay;
  end if;

  v_cancel_snapshot := v_cancel_replay->'result';
  if v_cancel_snapshot is null then
    raise exception 'expected cancelled replay result snapshot';
  end if;

  if v_cancel_snapshot <> v_cancel_first then
    raise exception 'expected cancelled replay payload to equal first payload. first=% replay=%', v_cancel_first, v_cancel_snapshot;
  end if;

  if (select count(*) from public.salon_appointment_status_history where appointment_id = '50000000-0000-0000-0000-000000000002') <> v_after_history then
    raise exception 'cancelled replay duplicated history rows';
  end if;

  if (select count(*) from public.strong_audit_logs) <> v_after_audit then
    raise exception 'cancelled replay duplicated audit rows';
  end if;

  -- instructor ownership/operation restrictions
  begin
    perform public.transition_salon_appointment_status(
      '90000000-0000-0000-0000-000000000002',
      'instructor',
      '30000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'in_progress',
      null,
      null,
      null
    );
    raise exception 'expected instructor non-owner update to fail';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    perform public.transition_salon_appointment_status(
      '90000000-0000-0000-0000-000000000002',
      'instructor',
      '30000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'no_show',
      'forbidden',
      null,
      null
    );
    raise exception 'expected instructor no_show transition to fail';
  exception when sqlstate '42501' then
    null;
  end;
end
$$;

select 'apt03_calendar_status_ok' as result;
