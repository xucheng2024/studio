\set ON_ERROR_STOP on

select set_config('apt03_uat.studio_id', :'apt03_uat_studio_id', false);
select set_config('apt03_uat.location_l1_id', :'apt03_uat_location_l1_id', false);
select set_config('apt03_uat.location_l2_id', :'apt03_uat_location_l2_id', false);
select set_config('apt03_uat.employee_l1_id', :'apt03_uat_employee_l1_id', false);
select set_config('apt03_uat.employee_l2_id', :'apt03_uat_employee_l2_id', false);
select set_config('apt03_uat.service_id', :'apt03_uat_service_id', false);
select set_config('apt03_uat.customer_l1_id', :'apt03_uat_customer_l1_id', false);
select set_config('apt03_uat.customer_l2_id', :'apt03_uat_customer_l2_id', false);
select set_config('apt03_uat.customer_user_id', :'apt03_uat_customer_user_id', false);

do $$
declare
  v_studio uuid := current_setting('apt03_uat.studio_id')::uuid;
  v_l1 uuid := current_setting('apt03_uat.location_l1_id')::uuid;
  v_l2 uuid := current_setting('apt03_uat.location_l2_id')::uuid;
  v_employee_l1 uuid := current_setting('apt03_uat.employee_l1_id')::uuid;
  v_employee_l2 uuid := current_setting('apt03_uat.employee_l2_id')::uuid;
  v_service uuid := current_setting('apt03_uat.service_id')::uuid;
  v_customer_l1 uuid := current_setting('apt03_uat.customer_l1_id')::uuid;
  v_customer_l2 uuid := current_setting('apt03_uat.customer_l2_id')::uuid;
  v_customer_user uuid := current_setting('apt03_uat.customer_user_id')::uuid;
  v_owner uuid := 'a1000000-0000-4000-8000-000000000101';
  v_manager uuid := 'a1000000-0000-4000-8000-000000000102';
  v_frontdesk uuid := 'a1000000-0000-4000-8000-000000000103';
  v_instructor uuid := 'a1000000-0000-4000-8000-000000000104';
  v_weekday integer;
  v_created jsonb;
begin
  if exists (
    select 1
    from (values
      (v_owner, 'apt-local-owner@example.test'), (v_manager, 'apt-local-manager@example.test'),
      (v_frontdesk, 'apt-local-frontdesk@example.test'), (v_instructor, 'apt-local-instructor@example.test'),
      (v_customer_user, 'apt-local-customer@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then
    raise exception 'APT-03 local fixture requires exact local Auth identities';
  end if;

  insert into public.users (id, email) values
    (v_owner, 'apt-local-owner@example.test'), (v_manager, 'apt-local-manager@example.test'),
    (v_frontdesk, 'apt-local-frontdesk@example.test'), (v_instructor, 'apt-local-instructor@example.test'),
    (v_customer_user, 'apt-local-customer@example.test')
  on conflict (id) do update set email = excluded.email;

  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'apt-local-owner@example.test', 'APT-03 local owner', 'member'),
    (v_manager, 'apt-local-manager@example.test', 'APT-03 local manager', 'member'),
    (v_frontdesk, 'apt-local-frontdesk@example.test', 'APT-03 local frontdesk', 'member'),
    (v_instructor, 'apt-local-instructor@example.test', 'APT-03 local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

  insert into public.studios (id, owner_id, name, public_slug, contract_status)
  values (v_studio, v_owner, 'APT-03 local UAT', 'apt03-uat-' || left(replace(v_studio::text, '-', ''), 12), 'active');

  insert into public.locations (id, studio_id, name, is_active) values
    (v_l1, v_studio, 'APT-03 L1', true),
    (v_l2, v_studio, 'APT-03 L2', true);

  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    (gen_random_uuid(), v_manager, v_studio, null, 'manager', true),
    (gen_random_uuid(), v_frontdesk, v_studio, v_l1, 'frontdesk', true),
    (gen_random_uuid(), v_instructor, v_studio, v_l1, 'instructor', true)
  on conflict do nothing;

  insert into public.employees (id, studio_id, user_id, display_name, employment_status) values
    (v_employee_l1, v_studio, v_instructor, 'APT-03 instructor', 'active'),
    (v_employee_l2, v_studio, null, 'APT-03 L2 employee', 'active');

  insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active) values
    (v_employee_l1, v_l1, v_studio, true, true),
    (v_employee_l2, v_l2, v_studio, true, true);

  insert into public.studio_services (id, studio_id, title, price, currency, is_active, default_duration_minutes)
  values (v_service, v_studio, 'APT-03 local service', 90, 'SGD', true, 60);

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values) values
    (v_studio, v_service, v_l1, true, true),
    (v_studio, v_service, v_l2, true, true)
  on conflict (service_id, location_id) do update set is_enabled = true, uses_default_values = true;

  insert into public.service_employees (studio_id, service_id, employee_id, is_active) values
    (v_studio, v_service, v_employee_l1, true),
    (v_studio, v_service, v_employee_l2, true)
  on conflict (service_id, employee_id) do update set is_active = true;

  for v_weekday in 0..6 loop
    insert into public.location_operating_hours (studio_id, location_id, weekday, is_closed, opens_at, closes_at) values
      (v_studio, v_l1, v_weekday, false, '08:00', '21:00'),
      (v_studio, v_l2, v_weekday, false, '08:00', '21:00');
    insert into public.employee_working_hours (studio_id, employee_id, location_id, weekday, starts_at, ends_at, is_active) values
      (v_studio, v_employee_l1, v_l1, v_weekday, '08:00', '21:00', true),
      (v_studio, v_employee_l2, v_l2, v_weekday, '08:00', '21:00', true);
  end loop;

  insert into public.salon_customers (id, studio_id, user_id, full_name, email, status, source, preferred_location_id) values
    (v_customer_l1, v_studio, v_customer_user, 'APT-03 L1 customer', 'apt-local-customer@example.test', 'active', 'frontdesk', v_l1),
    (v_customer_l2, v_studio, null, 'APT-03 L2 customer', null, 'active', 'frontdesk', v_l2);

  v_created := public.create_salon_appointment(
    p_actor_id := v_owner,
    p_actor_role := 'owner',
    p_studio_id := v_studio,
    p_location_id := v_l2,
    p_salon_customer_id := v_customer_l2,
    p_service_id := v_service,
    p_employee_id := v_employee_l2,
    p_starts_at := timestamptz '2026-08-19 02:00:00+00'
  );
  if coalesce((v_created->>'ok')::boolean, false) is not true then
    raise exception 'APT-03 L2 fixture appointment failed: %', v_created;
  end if;
end $$;

select 'apt03_uat_fixture_ok' as result;
