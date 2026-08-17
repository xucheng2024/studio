\set ON_ERROR_STOP on

select set_config('pkg01_uat.studio_id', :'pkg01_uat_studio_id', false);
select set_config('pkg01_uat.location_id', :'pkg01_uat_location_id', false);
select set_config('pkg01_uat.customer_user_id', :'pkg01_uat_customer_user_id', false);
select set_config('pkg01_uat.customer_id', :'pkg01_uat_customer_id', false);
select set_config('pkg01_uat.package_id', :'pkg01_uat_package_id', false);
select set_config('pkg01_uat.sale_id', :'pkg01_uat_sale_id', false);
select set_config('pkg01_uat.sale_item_id', :'pkg01_uat_sale_item_id', false);
select set_config('pkg01_uat.payment_id', :'pkg01_uat_payment_id', false);

do $$
declare
  v_studio uuid := current_setting('pkg01_uat.studio_id')::uuid;
  v_location uuid := current_setting('pkg01_uat.location_id')::uuid;
  v_owner uuid := 'f3000000-0000-4000-8000-000000000101';
  v_manager uuid := 'f3000000-0000-4000-8000-000000000102';
  v_frontdesk uuid := 'f3000000-0000-4000-8000-000000000103';
  v_instructor uuid := 'f3000000-0000-4000-8000-000000000104';
  v_customer_user uuid := current_setting('pkg01_uat.customer_user_id')::uuid;
  v_customer uuid := current_setting('pkg01_uat.customer_id')::uuid;
  v_package uuid := current_setting('pkg01_uat.package_id')::uuid;
  v_sale uuid := current_setting('pkg01_uat.sale_id')::uuid;
  v_sale_item uuid := current_setting('pkg01_uat.sale_item_id')::uuid;
  v_payment uuid := current_setting('pkg01_uat.payment_id')::uuid;
  v_customer_email text := 'pos-local-customer@example.test';
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
    raise exception 'PKG-01 local fixture requires exact local Auth identities';
  end if;

  insert into public.users (id, email) values
    (v_owner, 'pos-local-owner@example.test'), (v_manager, 'pos-local-manager@example.test'),
    (v_frontdesk, 'pos-local-frontdesk@example.test'), (v_instructor, 'pos-local-instructor@example.test'),
    (v_customer_user, v_customer_email)
  on conflict (id) do update set email = excluded.email;

  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'pos-local-owner@example.test', 'PKG-01 local owner', 'member'),
    (v_manager, 'pos-local-manager@example.test', 'PKG-01 local manager', 'member'),
    (v_frontdesk, 'pos-local-frontdesk@example.test', 'PKG-01 local frontdesk', 'member'),
    (v_instructor, 'pos-local-instructor@example.test', 'PKG-01 local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

  insert into public.studios (id, owner_id, name, public_slug, contract_status)
  values (v_studio, v_owner, 'PKG-01 local UAT', 'pkg01-uat-' || left(replace(v_studio::text, '-', ''), 12), 'active');

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location, v_studio, 'PKG-01 Local', true);

  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    (gen_random_uuid(), v_manager, v_studio, null, 'manager', true),
    (gen_random_uuid(), v_frontdesk, v_studio, v_location, 'frontdesk', true),
    (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true)
  on conflict do nothing;

  insert into public.salon_customers (id, studio_id, user_id, full_name, email, status, source, preferred_location_id)
  values (v_customer, v_studio, v_customer_user, 'PKG-01 local customer', v_customer_email, 'active', 'frontdesk', v_location);

  insert into public.packages (id, studio_id, name, price, credits, expiry_days, is_active)
  values (v_package, v_studio, 'PKG-01 local package', 120, 6, 30, true);

  insert into public.pos_sales (
    id, studio_id, location_id, salon_customer_id, cashier_user_id, status, currency,
    subtotal_amount, discount_amount, tax_amount, total_amount, note, locked_at, submitted_at, created_by, updated_by
  ) values (
    v_sale, v_studio, v_location, v_customer, v_owner, 'pending_payment', 'SGD',
    120, 0, 0, 120, 'PKG-01 local package grant', now(), now(), v_owner, v_owner
  );

  insert into public.pos_sale_items (
    id, sale_id, studio_id, location_id, line_number, item_type, package_id, item_name_snapshot,
    item_currency_snapshot, quantity, unit_price_amount, subtotal_amount, discount_amount, tax_amount, total_amount
  ) values (
    v_sale_item, v_sale, v_studio, v_location, 1, 'package', v_package, 'PKG-01 local package',
    'SGD', 1, 120, 120, 0, 0, 120
  );

  insert into public.payments (
    id, studio_id, location_id, client_id, pos_sale_id, amount, currency, payment_method,
    sales_channel, source, status, reference_code, type, remaining_uses, package_id, package_name_snapshot
  ) values (
    v_payment, v_studio, v_location, v_customer_user, v_sale, 120, 'SGD', 'cash',
    'frontdesk', 'pos_sale', 'pending', 'PKG01-UAT-' || left(replace(v_payment::text, '-', ''), 16), 'package', 0,
    v_package, 'PKG-01 local package'
  );
end $$;

select 'pkg01_uat_fixture_ok' as result;
