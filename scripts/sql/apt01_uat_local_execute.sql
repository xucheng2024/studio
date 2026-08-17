\set ON_ERROR_STOP on

select set_config('apt01_uat.studio_id', :'apt01_uat_studio_id', false);
select set_config('apt01_uat.location_id', :'apt01_uat_location_id', false);
select set_config('apt01_uat.employee_id', :'apt01_uat_employee_id', false);
select set_config('apt01_uat.service_id', :'apt01_uat_service_id', false);

do $$
declare
  v_studio uuid := current_setting('apt01_uat.studio_id')::uuid;
  v_location uuid := current_setting('apt01_uat.location_id')::uuid;
  v_employee uuid := current_setting('apt01_uat.employee_id')::uuid;
  v_service uuid := current_setting('apt01_uat.service_id')::uuid;
  v_owner uuid := 'a1000000-0000-4000-8000-000000000101';
  v_manager uuid := 'a1000000-0000-4000-8000-000000000102';
  v_frontdesk uuid := 'a1000000-0000-4000-8000-000000000103';
  v_instructor uuid := 'a1000000-0000-4000-8000-000000000104';
begin
  if exists (
    select 1
    from (values
      (v_owner, 'apt-local-owner@example.test'), (v_manager, 'apt-local-manager@example.test'),
      (v_frontdesk, 'apt-local-frontdesk@example.test'), (v_instructor, 'apt-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then
    raise exception 'APT-01 local fixture requires exact local Auth identities';
  end if;

  insert into public.users (id, email) values
    (v_owner, 'apt-local-owner@example.test'), (v_manager, 'apt-local-manager@example.test'),
    (v_frontdesk, 'apt-local-frontdesk@example.test'), (v_instructor, 'apt-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;

  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'apt-local-owner@example.test', 'APT-01 local owner', 'member'),
    (v_manager, 'apt-local-manager@example.test', 'APT-01 local manager', 'member'),
    (v_frontdesk, 'apt-local-frontdesk@example.test', 'APT-01 local frontdesk', 'member'),
    (v_instructor, 'apt-local-instructor@example.test', 'APT-01 local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

  insert into public.studios (id, owner_id, name, public_slug, contract_status)
  values (v_studio, v_owner, 'APT-01 local UAT', 'apt01-uat-' || left(replace(v_studio::text, '-', ''), 12), 'active');

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location, v_studio, 'APT-01 Local', true);

  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    (gen_random_uuid(), v_manager, v_studio, null, 'manager', true),
    (gen_random_uuid(), v_frontdesk, v_studio, v_location, 'frontdesk', true),
    (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true)
  on conflict do nothing;

  insert into public.employees (id, studio_id, user_id, display_name, employment_status)
  values (v_employee, v_studio, v_instructor, 'APT-01 instructor', 'active');

  insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
  values (v_employee, v_location, v_studio, true, true);

  insert into public.studio_services (id, studio_id, title, price, currency, is_active, default_duration_minutes)
  values (v_service, v_studio, 'APT-01 local service', 80, 'SGD', true, 60);

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
  values (v_studio, v_service, v_location, true, true)
  on conflict (service_id, location_id) do update set is_enabled = true, uses_default_values = true;
end $$;

select 'apt01_uat_fixture_ok' as result;
