\set ON_ERROR_STOP on

select set_config('apt04_settlement_uat.studio_id', :'apt04_settlement_uat_studio_id', false);
select set_config('apt04_settlement_uat.location_id', :'apt04_settlement_uat_location_id', false);
select set_config('apt04_settlement_uat.service_id', :'apt04_settlement_uat_service_id', false);
select set_config('apt04_settlement_uat.employee_id', :'apt04_settlement_uat_employee_id', false);
select set_config('apt04_settlement_uat.customer_user_id', :'apt04_settlement_uat_customer_user_id', false);
select set_config('apt04_settlement_uat.customer_id', :'apt04_settlement_uat_customer_id', false);
select set_config('apt04_settlement_uat.package_id', :'apt04_settlement_uat_package_id', false);
select set_config('apt04_settlement_uat.client_package_id', :'apt04_settlement_uat_client_package_id', false);
select set_config('apt04_settlement_uat.terms_id', :'apt04_settlement_uat_terms_id', false);

do $$
declare
  v_studio uuid := current_setting('apt04_settlement_uat.studio_id')::uuid;
  v_location uuid := current_setting('apt04_settlement_uat.location_id')::uuid;
  v_service uuid := current_setting('apt04_settlement_uat.service_id')::uuid;
  v_employee uuid := current_setting('apt04_settlement_uat.employee_id')::uuid;
  v_customer_user uuid := current_setting('apt04_settlement_uat.customer_user_id')::uuid;
  v_customer uuid := current_setting('apt04_settlement_uat.customer_id')::uuid;
  v_package uuid := current_setting('apt04_settlement_uat.package_id')::uuid;
  v_client_package uuid := current_setting('apt04_settlement_uat.client_package_id')::uuid;
  v_terms uuid := current_setting('apt04_settlement_uat.terms_id')::uuid;
  v_owner uuid := 'f3000000-0000-4000-8000-000000000101';
  v_manager uuid := 'f3000000-0000-4000-8000-000000000102';
  v_frontdesk uuid := 'f3000000-0000-4000-8000-000000000103';
  v_instructor uuid := 'f3000000-0000-4000-8000-000000000104';
  v_customer_email text := 'pos-local-customer@example.test';
  v_weekday integer;
begin
  if exists (
    select 1
    from (values
      (v_owner, 'pos-local-owner@example.test'), (v_manager, 'pos-local-manager@example.test'),
      (v_frontdesk, 'pos-local-frontdesk@example.test'), (v_instructor, 'pos-local-instructor@example.test'),
      (v_customer_user, v_customer_email)
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then
    raise exception 'APT-04 settlement local fixture requires exact local Auth identities';
  end if;

  insert into public.users (id, email) values
    (v_owner, 'pos-local-owner@example.test'), (v_manager, 'pos-local-manager@example.test'),
    (v_frontdesk, 'pos-local-frontdesk@example.test'), (v_instructor, 'pos-local-instructor@example.test'),
    (v_customer_user, v_customer_email)
  on conflict (id) do update set email = excluded.email;

  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'pos-local-owner@example.test', 'APT-04 settlement owner', 'member'),
    (v_manager, 'pos-local-manager@example.test', 'APT-04 settlement manager', 'member'),
    (v_frontdesk, 'pos-local-frontdesk@example.test', 'APT-04 settlement frontdesk', 'member'),
    (v_instructor, 'pos-local-instructor@example.test', 'APT-04 settlement instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

  insert into public.studios (id, owner_id, name, public_slug, contract_status, hitpay_enabled)
  values (
    v_studio,
    v_owner,
    'APT-04 settlement UAT',
    'apt04-set-' || left(replace(v_studio::text, '-', ''), 12),
    'active',
    true
  );

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location, v_studio, 'APT-04 Settlement Local', true);

  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    (gen_random_uuid(), v_manager, v_studio, null, 'manager', true),
    (gen_random_uuid(), v_frontdesk, v_studio, v_location, 'frontdesk', true),
    (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true)
  on conflict do nothing;

  insert into public.employees (id, studio_id, user_id, display_name, employment_status)
  values (v_employee, v_studio, v_instructor, 'APT-04 settlement staff', 'active');

  insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
  values (v_employee, v_location, v_studio, true, true);

  insert into public.studio_services (
    id, studio_id, title, price, currency, is_active,
    default_duration_minutes, default_prep_minutes, default_buffer_minutes
  )
  values (v_service, v_studio, 'APT-04 settlement service', 100, 'SGD', true, 60, 0, 0);

  insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
  values (v_studio, v_service, v_location, true, true)
  on conflict (service_id, location_id) do update set is_enabled = true, uses_default_values = true;

  insert into public.service_employees (studio_id, service_id, employee_id, is_active)
  values (v_studio, v_service, v_employee, true)
  on conflict (service_id, employee_id) do update set is_active = true;

  for v_weekday in 0..6 loop
    insert into public.location_operating_hours (studio_id, location_id, weekday, is_closed, opens_at, closes_at)
    values (v_studio, v_location, v_weekday, false, '08:00', '21:00');
    insert into public.employee_working_hours (studio_id, employee_id, location_id, weekday, starts_at, ends_at, is_active)
    values (v_studio, v_employee, v_location, v_weekday, '08:00', '21:00', true);
  end loop;

  insert into public.salon_customers (id, studio_id, user_id, full_name, email, status, source, preferred_location_id)
  values (v_customer, v_studio, v_customer_user, 'APT-04 settlement customer', v_customer_email, 'active', 'online', v_location);

  insert into public.salon_terms_versions (
    id, studio_id, version_label, content_hash, content_snapshot, is_active, published_at
  )
  values (
    v_terms,
    v_studio,
    'apt04-settlement-v1',
    'apt04-settlement-hash-v1',
    '{"title":"APT-04 settlement terms","body":"UAT-only terms. No production data."}'::jsonb,
    true,
    now()
  );

  insert into public.salon_privacy_notice_versions (
    studio_id, version_label, content_hash, content_snapshot, is_active, published_at
  )
  values (
    v_studio,
    'apt04-settlement-privacy-v1',
    'apt04-settlement-privacy-hash-v1',
    '{"title":"APT-04 settlement privacy","body":"UAT-only privacy notice. No production data."}'::jsonb,
    true,
    now()
  );

  insert into public.packages (id, studio_id, name, credits, price, location_id, type, is_active, expiry_days)
  values (v_package, v_studio, 'APT-04 settlement pack', 6, 120, v_location, 'class_pack', true, 30);

  insert into public.client_packages (
    id, client_id, package_id, credits_left, expiry_date,
    package_name_snapshot, package_credits_snapshot, package_expiry_days_snapshot
  )
  values (
    v_client_package,
    v_customer_user,
    v_package,
    3,
    now() + interval '30 days',
    'APT-04 settlement pack',
    6,
    30
  );
end $$;

select 'apt04_settlement_uat_fixture_ok' as result;
