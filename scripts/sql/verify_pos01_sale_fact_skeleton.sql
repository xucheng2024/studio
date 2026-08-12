do $$
declare
  v_studio_id uuid := '11111111-1111-1111-1111-111111111111';
  v_location_id uuid := '22222222-2222-2222-2222-222222222222';
  v_customer_id uuid := '33333333-3333-3333-3333-333333333333';
  v_user_id uuid := '44444444-4444-4444-4444-444444444444';
  v_employee_id uuid := '55555555-5555-5555-5555-555555555555';
  v_service_id uuid := '66666666-6666-6666-6666-666666666666';
  v_product_id uuid := '77777777-7777-7777-7777-777777777777';
  v_package_id uuid := '88888888-8888-8888-8888-888888888888';
  v_appointment_id uuid := '99999999-9999-9999-9999-999999999999';
  v_sale_id uuid;
  v_bad_sale_id uuid;
begin
  if to_regclass('public.pos_sales') is null then
    raise exception 'missing table public.pos_sales';
  end if;

  if to_regclass('public.pos_sale_items') is null then
    raise exception 'missing table public.pos_sale_items';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'pos_sales'
      and indexname = 'pos_sales_studio_sale_number_unique'
  ) then
    raise exception 'missing index pos_sales_studio_sale_number_unique';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'pos_sale_items'
      and indexname = 'pos_sale_items_sale_line_unique'
  ) then
    raise exception 'missing index pos_sale_items_sale_line_unique';
  end if;

  insert into public.studios (id, contract_status)
  values (v_studio_id, 'active')
  on conflict (id) do nothing;

  insert into public.users (id, email)
  values (v_user_id, 'pos01@example.com')
  on conflict (id) do nothing;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'Main Branch')
  on conflict (id) do nothing;

  insert into public.salon_customers (id, studio_id, user_id, full_name)
  values (v_customer_id, v_studio_id, v_user_id, 'Customer A')
  on conflict (id) do nothing;

  insert into public.employees (id, studio_id, display_name)
  values (v_employee_id, v_studio_id, 'Employee A')
  on conflict (id) do nothing;

  insert into public.studio_services (id, studio_id, name)
  values (v_service_id, v_studio_id, 'Service A')
  on conflict (id) do nothing;

  insert into public.shop_products (id, studio_id, name)
  values (v_product_id, v_studio_id, 'Product A')
  on conflict (id) do nothing;

  insert into public.packages (id, studio_id, name)
  values (v_package_id, v_studio_id, 'Package A')
  on conflict (id) do nothing;

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id, status
  ) values (
    v_appointment_id, v_studio_id, v_location_id, v_customer_id, v_service_id, v_employee_id, 'confirmed'
  )
  on conflict (id) do nothing;

  insert into public.pos_sales (
    studio_id,
    location_id,
    salon_customer_id,
    cashier_user_id,
    sale_number,
    status,
    currency,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount,
    created_by,
    updated_by
  ) values (
    v_studio_id,
    v_location_id,
    v_customer_id,
    v_user_id,
    'SALE-001',
    'draft',
    'SGD',
    100,
    10,
    8,
    98,
    v_user_id,
    v_user_id
  )
  returning id into v_sale_id;

  insert into public.pos_sale_items (
    sale_id,
    studio_id,
    location_id,
    line_number,
    item_type,
    service_id,
    salon_appointment_id,
    employee_id,
    item_name_snapshot,
    item_currency_snapshot,
    quantity,
    unit_price_amount,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount
  ) values (
    v_sale_id,
    v_studio_id,
    v_location_id,
    1,
    'service',
    v_service_id,
    v_appointment_id,
    v_employee_id,
    'Service A',
    'SGD',
    1,
    100,
    100,
    10,
    8,
    98
  );

  begin
    insert into public.pos_sale_items (
      sale_id,
      studio_id,
      location_id,
      line_number,
      item_type,
      service_id,
      product_id,
      item_name_snapshot,
      item_currency_snapshot,
      quantity,
      unit_price_amount,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount
    ) values (
      v_sale_id,
      v_studio_id,
      v_location_id,
      2,
      'service',
      v_service_id,
      v_product_id,
      'Broken Item',
      'SGD',
      1,
      10,
      10,
      0,
      0,
      10
    );
    raise exception 'expected pos_sale_items_source_type_check to reject invalid source mix';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into public.pos_sales (
      studio_id,
      location_id,
      sale_number,
      currency,
      subtotal_amount,
      discount_amount,
      tax_amount,
      total_amount
    ) values (
      v_studio_id,
      v_location_id,
      'SALE-002',
      'SGD',
      100,
      20,
      7,
      90
    )
    returning id into v_bad_sale_id;

    raise exception 'expected pos_sales_totals_check to reject invalid total %', v_bad_sale_id;
  exception
    when check_violation then
      null;
  end;

  raise notice 'verify_pos01_sale_fact_skeleton: ok';
end;
$$;

