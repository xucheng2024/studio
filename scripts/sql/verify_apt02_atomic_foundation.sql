\set ON_ERROR_STOP on

truncate table public.strong_audit_logs restart identity;

insert into public.users (id, email) values
  ('90000000-0000-0000-0000-000000000001', 'owner-s1@example.com'),
  ('90000000-0000-0000-0000-000000000002', 'owner-s2@example.com')
on conflict (id) do nothing;

insert into public.studios (id, contract_status) values
  ('00000000-0000-0000-0000-000000000001', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'S1-L1', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'S1-L2', true),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'S2-L1', true)
on conflict (id) do nothing;

insert into public.studio_services (id, studio_id, name, price, currency, is_active) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'S1-Main', 120, 'SGD', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'S1-DisabledAtL1', 88, 'SGD', true),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'S2-Main', 90, 'SGD', true)
on conflict (id) do nothing;

insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', true, true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true, true),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', false, true),
  ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', true, true)
on conflict (service_id, location_id) do update
set is_enabled = excluded.is_enabled;

insert into public.salon_customers (id, studio_id, full_name, status, source)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'S1-Customer', 'active', 'frontdesk'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'S2-Customer', 'active', 'frontdesk')
on conflict (id) do nothing;

insert into public.employees (id, studio_id, display_name, employment_status, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'S1-E1', 'active', true),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'S1-E2', 'active', true),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'S1-E3-NoEligibility', 'active', true),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'S2-E1', 'active', true)
on conflict (id) do nothing;

insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', true)
on conflict do nothing;

select public.set_service_employee_eligibility(
  '90000000-0000-0000-0000-000000000001',
  'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  true
);

select public.set_service_employee_eligibility(
  '90000000-0000-0000-0000-000000000001',
  'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  true
);

select public.set_service_employee_eligibility(
  '90000000-0000-0000-0000-000000000002',
  'owner',
  '00000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000004',
  true
);

select public.set_location_operating_hours_for_weekday(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  1,
  false,
  jsonb_build_array(jsonb_build_object('opens_at', '08:00', 'closes_at', '21:00'))
);

select public.set_location_operating_hours_for_weekday(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  1,
  false,
  jsonb_build_array(jsonb_build_object('opens_at', '08:00', 'closes_at', '21:00'))
);

select public.set_employee_working_hours_for_weekday(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  1,
  jsonb_build_array(jsonb_build_object('starts_at', '09:00', 'ends_at', '18:00')),
  null,
  null
);

select public.set_employee_working_hours_for_weekday(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  1,
  jsonb_build_array(jsonb_build_object('starts_at', '09:00', 'ends_at', '18:00')),
  null,
  null
);

select public.set_employee_working_hours_for_weekday(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  1,
  jsonb_build_array(jsonb_build_object('starts_at', '09:00', 'ends_at', '18:00')),
  null,
  null
);

select public.create_employee_availability_exception(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'unavailable',
  'break',
  '2026-08-17 04:00:00+00',
  '2026-08-17 05:00:00+00',
  '10000000-0000-0000-0000-000000000001',
  'Lunch break'
);

select public.create_employee_availability_exception(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'available',
  'overtime',
  '2026-08-17 10:00:00+00',
  '2026-08-17 12:00:00+00',
  '10000000-0000-0000-0000-000000000001',
  'Overtime slot'
);

select public.upsert_salon_resource(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'L1-Room-1', 'room', 1, null
);

select public.upsert_salon_resource(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'L1-Bed-1', 'bed', 1, null
);

select public.upsert_salon_resource(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'L2-Room-1', 'room', 1, null
);

select public.upsert_salon_resource(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'L2-Bed-1', 'bed', 1, null
);

select public.set_service_resource_requirement(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'room', 1
);

select public.set_service_resource_requirement(
  '90000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'bed', 1
);

DO $$
declare
  v_room_l1 uuid;
  v_bed_l1 uuid;
  v_room_l2 uuid;
  v_bed_l2 uuid;
  v_a1 uuid;
  v_a2 uuid;
  v_terms_version uuid;
  v_cancel jsonb;
  v_created jsonb;
  v_count integer;
  v_old_start timestamptz;
  v_new_start timestamptz;
begin
  select id into v_room_l1 from public.salon_resources where studio_id = '00000000-0000-0000-0000-000000000001' and location_id = '10000000-0000-0000-0000-000000000001' and name = 'L1-Room-1';
  select id into v_bed_l1 from public.salon_resources where studio_id = '00000000-0000-0000-0000-000000000001' and location_id = '10000000-0000-0000-0000-000000000001' and name = 'L1-Bed-1';
  select id into v_room_l2 from public.salon_resources where studio_id = '00000000-0000-0000-0000-000000000001' and location_id = '10000000-0000-0000-0000-000000000002' and name = 'L2-Room-1';
  select id into v_bed_l2 from public.salon_resources where studio_id = '00000000-0000-0000-0000-000000000001' and location_id = '10000000-0000-0000-0000-000000000002' and name = 'L2-Bed-1';

  -- 1) valid create succeeds
  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '2026-08-17 02:00:00+00',
    array[v_room_l1, v_bed_l1],
    null,
    null,
    null,
    null,
    null,
    '2026-08-17 02:20:00+00',
    null,
    null
  );
  if coalesce((v_created->>'ok')::boolean, false) is not true then
    raise exception 'expected valid create to succeed, got %', v_created;
  end if;
  v_a1 := (v_created->>'appointment_id')::uuid;

  -- 2) cross-studio customer rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 06:00:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected cross-studio customer rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 3) disabled service rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 06:10:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected disabled service rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 4) ineligible employee rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000003',
      '2026-08-17 06:20:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected ineligible employee rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 5) outside working hours rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 00:00:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected outside working hours rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 6) unavailable exception rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 04:20:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected unavailable exception rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 7) available exception outside working hours allowed
  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '2026-08-17 10:30:00+00',
    array[v_room_l1, v_bed_l1],
    null, null, null, null, null,
    null,
    null,
    null
  );
  if coalesce((v_created->>'ok')::boolean, false) is not true then
    raise exception 'expected available-exception create to succeed, got %', v_created;
  end if;

  -- 8) wrong location resource rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      '2026-08-17 07:00:00+00',
      array[v_room_l2, v_bed_l2],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected wrong location resource rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 9) missing required resource rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      '2026-08-17 07:10:00+00',
      array[v_room_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected missing required resource rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 10) employee overlap same location rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 02:30:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected employee overlap same-location rejection';
  exception when sqlstate '23P01' then
    null;
  end;

  -- 11) employee overlap across locations rejected
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-17 02:30:00+00',
      array[v_room_l2, v_bed_l2],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected employee overlap cross-location rejection';
  exception when sqlstate '23P01' then
    null;
  end;

  -- 12) resource overlap rejected (different employee)
  begin
    perform public.create_salon_appointment(
      '90000000-0000-0000-0000-000000000001', 'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      '2026-08-17 02:30:00+00',
      array[v_room_l1, v_bed_l1],
      null, null, null, null, null,
      null,
      null,
      null
    );
    raise exception 'expected resource overlap rejection';
  exception when sqlstate '23P01' then
    null;
  end;

  -- 13) failed reschedule preserves original
  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '2026-08-17 06:00:00+00',
    array[v_room_l1, v_bed_l1],
    null, null, null, null, null,
    null,
    null,
    null
  );
  v_a2 := (v_created->>'appointment_id')::uuid;

  select starts_at into v_old_start from public.salon_appointments where id = v_a2;

  begin
    perform public.reschedule_salon_appointment(
      '90000000-0000-0000-0000-000000000001',
      'owner',
      '00000000-0000-0000-0000-000000000001',
      v_a2,
      '2026-08-17 02:30:00+00',
      array[v_room_l1, v_bed_l1],
      'conflict expected',
      null,
      null,
      null,
      null,
      null
    );
    raise exception 'expected reschedule conflict rejection';
  exception when sqlstate '23P01' then
    null;
  end;

  select starts_at into v_new_start from public.salon_appointments where id = v_a2;
  if v_old_start <> v_new_start then
    raise exception 'failed reschedule should preserve original starts_at';
  end if;

  -- 14) cancel and repeat cancel are idempotent, releases occupancy
  v_cancel := public.cancel_salon_appointment(
    '90000000-0000-0000-0000-000000000001',
    'owner',
    '00000000-0000-0000-0000-000000000001',
    v_a1,
    'customer requested',
    null
  );
  if coalesce((v_cancel->>'ok')::boolean, false) is not true then
    raise exception 'expected first cancellation to succeed, got %', v_cancel;
  end if;

  v_cancel := public.cancel_salon_appointment(
    '90000000-0000-0000-0000-000000000001',
    'owner',
    '00000000-0000-0000-0000-000000000001',
    v_a1,
    'repeat cancellation',
    null
  );
  if coalesce((v_cancel->>'already_cancelled')::boolean, false) is not true then
    raise exception 'expected repeat cancellation to be idempotent, got %', v_cancel;
  end if;

  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '2026-08-17 02:00:00+00',
    array[v_room_l1, v_bed_l1],
    null, null, null, null, null,
    null,
    null,
    null
  );
  if coalesce((v_created->>'ok')::boolean, false) is not true then
    raise exception 'expected create after cancellation to succeed, got %', v_created;
  end if;

  -- 15) pending expiration repeatable
  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '2026-08-17 08:00:00+00',
    array[v_room_l1, v_bed_l1],
    null, null, null, null, null,
    now() - interval '5 minutes',
    null,
    null
  );

  v_count := public.expire_pending_salon_appointments(200);
  if v_count < 1 then
    raise exception 'expected expire_pending_salon_appointments to expire >=1 row';
  end if;

  if public.expire_pending_salon_appointments(200) < 0 then
    raise exception 'unexpected negative expired count';
  end if;

  -- 16) append-only status history reject update/delete
  begin
    update public.salon_appointment_status_history
    set reason = 'tamper'
    where id = (select id from public.salon_appointment_status_history order by created_at limit 1);
    raise exception 'expected status_history append-only update rejection';
  exception when sqlstate '23514' then
    null;
  end;

  -- 17) terms acceptance append-only and cross-studio rejection
  insert into public.salon_terms_versions (studio_id, version_label, content_hash, content_snapshot)
  values (
    '00000000-0000-0000-0000-000000000001',
    'v1',
    'hash-v1',
    jsonb_build_object('title', 'Terms v1')
  )
  returning id into v_terms_version;

  v_created := public.create_salon_appointment(
    '90000000-0000-0000-0000-000000000001', 'owner',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '2026-08-17 07:30:00+00',
    array[v_room_l1, v_bed_l1],
    v_terms_version,
    now(),
    'frontdesk',
    'offline_confirmation',
    '90000000-0000-0000-0000-000000000001',
    null,
    null,
    null
  );

  begin
    insert into public.salon_terms_acceptances (
      studio_id,
      terms_version_id,
      appointment_id,
      salon_customer_id,
      accepted_at,
      acceptance_channel,
      acceptance_method,
      recorded_by,
      content_hash_snapshot,
      version_label_snapshot
    ) values (
      '00000000-0000-0000-0000-000000000002',
      v_terms_version,
      null,
      '40000000-0000-0000-0000-000000000002',
      now(),
      'frontdesk',
      'manual',
      '90000000-0000-0000-0000-000000000002',
      'hash-v1',
      'v1'
    );
    raise exception 'expected cross-studio terms acceptance rejection';
  exception when sqlstate '23514' then
    null;
  end;

  begin
    update public.salon_terms_acceptances
    set acceptance_channel = 'tampered'
    where id = (select id from public.salon_terms_acceptances order by created_at limit 1);
    raise exception 'expected terms_acceptances append-only update rejection';
  exception when sqlstate '23514' then
    null;
  end;

  if (select count(*) from public.strong_audit_logs where target_type = 'salon_appointment') < 1 then
    raise exception 'expected strong audit rows for appointments';
  end if;

  if (select count(*) from public.salon_appointment_status_history) < 3 then
    raise exception 'expected status history rows to exist';
  end if;
end
$$;

select 'apt02_atomic_foundation_verification_ok' as result;
