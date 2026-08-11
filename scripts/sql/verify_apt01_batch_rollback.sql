\set ON_ERROR_STOP on

truncate table public.strong_audit_logs restart identity;

insert into public.studios (id, contract_status) values
  ('00000000-0000-0000-0000-000000000001', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'S1-L1', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'S2-L1', true)
on conflict (id) do nothing;

insert into public.studio_services (id, studio_id, name, is_active) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Svc-1', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Svc-2', true)
on conflict (id) do nothing;

insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', true, true),
  ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', true, true)
on conflict (service_id, location_id) do nothing;

insert into public.employees (id, studio_id, display_name, employment_status, is_active) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'E1', 'active', true),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'E2', 'active', true),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'E3-XStudio', 'active', true)
on conflict (id) do nothing;

insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', true)
on conflict do nothing;

-- seed two active eligibilities to detect partial update
select public.set_service_employee_eligibility(
  '40000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  true
);
select public.set_service_employee_eligibility(
  '40000000-0000-0000-0000-000000000001', 'owner',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  true
);

DO $$
BEGIN
  -- 1) set_service_employee_eligibilities: include cross-studio employee -> fail, no prior row changes
  BEGIN
    PERFORM public.set_service_employee_eligibilities(
      '40000000-0000-0000-0000-000000000001',
      'owner',
      '00000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      ARRAY[
        '30000000-0000-0000-0000-000000000001'::uuid,
        '30000000-0000-0000-0000-000000000003'::uuid
      ]
    );
    RAISE EXCEPTION 'expected set_service_employee_eligibilities to fail';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;

  IF (
    SELECT count(*)
    FROM public.service_employees
    WHERE studio_id = '00000000-0000-0000-0000-000000000001'
      AND service_id = '20000000-0000-0000-0000-000000000001'
      AND is_active = true
  ) <> 2 THEN
    RAISE EXCEPTION 'rollback check failed: service_employees changed unexpectedly';
  END IF;

  -- 2) set_location_operating_hours_for_week: 2nd day invalid -> whole batch rollback
  BEGIN
    PERFORM public.set_location_operating_hours_for_week(
      '40000000-0000-0000-0000-000000000001',
      'owner',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object('weekday', 0, 'is_closed', false, 'intervals', jsonb_build_array(jsonb_build_object('starts_at','09:00','ends_at','17:00'))),
        jsonb_build_object('weekday', 1, 'is_closed', false, 'intervals', jsonb_build_array(jsonb_build_object('starts_at','18:00','ends_at','10:00')))
      )
    );
    RAISE EXCEPTION 'expected set_location_operating_hours_for_week to fail';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.location_operating_hours
    WHERE studio_id = '00000000-0000-0000-0000-000000000001'
      AND location_id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'rollback check failed: location_operating_hours partially committed';
  END IF;

  -- 3) set_employee_working_hours_for_week: 2nd day invalid -> whole batch rollback
  BEGIN
    PERFORM public.set_employee_working_hours_for_week(
      '40000000-0000-0000-0000-000000000001',
      'owner',
      '00000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object('weekday', 2, 'intervals', jsonb_build_array(jsonb_build_object('starts_at','09:00','ends_at','17:00'))),
        jsonb_build_object('weekday', 3, 'intervals', jsonb_build_array(jsonb_build_object('starts_at','17:00','ends_at','09:00')))
      ),
      null,
      null
    );
    RAISE EXCEPTION 'expected set_employee_working_hours_for_week to fail';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.employee_working_hours
    WHERE studio_id = '00000000-0000-0000-0000-000000000001'
      AND employee_id = '30000000-0000-0000-0000-000000000001'
      AND location_id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'rollback check failed: employee_working_hours partially committed';
  END IF;

  -- 4) set_service_resource_requirements: 2nd item invalid type -> whole batch rollback
  BEGIN
    PERFORM public.set_service_resource_requirements(
      '40000000-0000-0000-0000-000000000001',
      'owner',
      '00000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object('resource_type','room','required_quantity',1),
        jsonb_build_object('resource_type','invalid_type','required_quantity',1)
      )
    );
    RAISE EXCEPTION 'expected set_service_resource_requirements to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.service_resource_requirements
    WHERE studio_id = '00000000-0000-0000-0000-000000000001'
      AND service_id = '20000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'rollback check failed: service_resource_requirements partially committed';
  END IF;
END
$$;

SELECT 'apt01_batch_rollback_verification_ok' as result;
