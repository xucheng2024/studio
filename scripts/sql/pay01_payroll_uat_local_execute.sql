\set ON_ERROR_STOP on

select set_config('pay01_uat.studio_id', :'pay01_uat_studio_id', false);
select set_config('pay01_uat.location_id', :'pay01_uat_location_id', false);
select set_config('pay01_uat.employee_id', :'pay01_uat_employee_id', false);

do $$
declare
  v_studio uuid := current_setting('pay01_uat.studio_id')::uuid;
  v_location uuid := current_setting('pay01_uat.location_id')::uuid;
  v_employee uuid := current_setting('pay01_uat.employee_id')::uuid;
  v_owner uuid := '197086ec-ef51-49f4-8c3e-fe076af476d3';
  v_manager uuid := 'f41ab2de-c920-4d70-8578-6292fd2ebe9f';
  v_instructor uuid := '6412ee4e-7bb2-47cd-8476-f404c03cfa39';
begin
  if exists (
    select 1 from (values
      (v_owner, 'pay01-local-owner@example.test'),
      (v_manager, 'pay01-local-manager@example.test'),
      (v_instructor, 'pay01-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'pay01 local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'pay01-local-owner@example.test'),
    (v_manager, 'pay01-local-manager@example.test'),
    (v_instructor, 'pay01-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'pay01-local-owner@example.test', 'PAY local owner', 'member'),
    (v_manager, 'pay01-local-manager@example.test', 'PAY local manager', 'member'),
    (v_instructor, 'pay01-local-instructor@example.test', 'PAY local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, 'PAY local UAT', 'pay01-local-' || left(v_studio::text, 8), 'active');
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'PAY Local', true);
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    (gen_random_uuid(), v_manager, v_studio, null, 'manager', true),
    (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);
  insert into public.employees (id, studio_id, user_id, display_name, email, employment_status)
    values (v_employee, v_studio, v_instructor, 'PAY local instructor', 'pay01-local-instructor@example.test', 'active');
  insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
    values (v_employee, v_location, v_studio, true, true);
end $$;
