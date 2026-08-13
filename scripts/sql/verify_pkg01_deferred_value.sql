-- verify_pkg01_deferred_value.sql
-- Validates PKG-01 deferred value view/RPC:
--   1) purchase grant snapshot valuation
--   2) fallback valuation using package snapshot credits
--   3) conflict reporting + auto-resolve after data fix

set check_function_bodies = off;

DO $$
declare
  v_studio_id uuid := 'aaaaaaaa-1111-1111-1111-111111111111'::uuid;
  v_location_id uuid := 'aaaaaaaa-2222-2222-2222-222222222222'::uuid;
  v_owner_id uuid := 'aaaaaaaa-3333-3333-3333-333333333333'::uuid;
  v_user_a uuid := 'aaaaaaaa-4444-4444-4444-444444444444'::uuid;
  v_user_b uuid := 'aaaaaaaa-5555-5555-5555-555555555555'::uuid;
  v_user_c uuid := 'aaaaaaaa-6666-6666-6666-666666666666'::uuid;
  v_customer_a uuid := 'aaaaaaaa-7777-7777-7777-777777777777'::uuid;
  v_customer_b uuid := 'aaaaaaaa-8888-8888-8888-888888888888'::uuid;
  v_customer_c uuid := 'aaaaaaaa-9999-9999-9999-999999999999'::uuid;

  v_pkg_grant uuid := 'bbbbbbbb-1111-1111-1111-111111111111'::uuid;
  v_pkg_fallback uuid := 'bbbbbbbb-2222-2222-2222-222222222222'::uuid;
  v_pkg_conflict uuid := 'bbbbbbbb-3333-3333-3333-333333333333'::uuid;

  v_cp_grant uuid := 'cccccccc-1111-1111-1111-111111111111'::uuid;
  v_cp_fallback uuid := 'cccccccc-2222-2222-2222-222222222222'::uuid;
  v_cp_conflict uuid := 'cccccccc-3333-3333-3333-333333333333'::uuid;

  v_sale_id uuid := 'dddddddd-1111-1111-1111-111111111111'::uuid;
  v_item_id uuid := 'dddddddd-2222-2222-2222-222222222222'::uuid;
  v_payment_id uuid := 'dddddddd-3333-3333-3333-333333333333'::uuid;

  v_row_count integer;
  v_conflict_open integer;
  v_conflict_resolved integer;
  v_unit_grant numeric(12,6);
  v_value_grant numeric(14,2);
  v_unit_fallback numeric(12,6);
  v_value_fallback numeric(14,2);
  v_summary_rows integer;
  v_summary_credits bigint;
  v_summary_value numeric(16,2);
begin
  insert into public.users (id, email)
  values
    (v_owner_id, 'owner+pkg01-deferred@example.com'),
    (v_user_a, 'user-a+pkg01-deferred@example.com'),
    (v_user_b, 'user-b+pkg01-deferred@example.com'),
    (v_user_c, 'user-c+pkg01-deferred@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, owner_id)
  values (v_studio_id, v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'PKG01 Deferred Verify Location')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.salon_customers (
    id,
    studio_id,
    user_id,
    full_name,
    email,
    status,
    source
  )
  values
    (v_customer_a, v_studio_id, v_user_a, 'Deferred Customer A', 'user-a+pkg01-deferred@example.com', 'active', 'frontdesk'),
    (v_customer_b, v_studio_id, v_user_b, 'Deferred Customer B', 'user-b+pkg01-deferred@example.com', 'active', 'frontdesk'),
    (v_customer_c, v_studio_id, v_user_c, 'Deferred Customer C', 'user-c+pkg01-deferred@example.com', 'active', 'frontdesk')
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        user_id = excluded.user_id,
        merged_into_id = null;

  insert into public.packages (id, studio_id, location_id, name, price, credits, expiry_days, is_active)
  values
    (v_pkg_grant, v_studio_id, v_location_id, 'Deferred Pkg Grant', 120, 6, 30, true),
    (v_pkg_fallback, v_studio_id, v_location_id, 'Deferred Pkg Fallback', 200, 10, 30, true),
    (v_pkg_conflict, v_studio_id, v_location_id, 'Deferred Pkg Conflict', 150, 0, 30, true)
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        price = excluded.price,
        credits = excluded.credits,
        expiry_days = excluded.expiry_days,
        is_active = excluded.is_active;

  insert into public.client_packages (
    id,
    client_id,
    package_id,
    credits_left,
    expiry_date,
    created_at,
    package_name_snapshot,
    package_credits_snapshot,
    package_expiry_days_snapshot
  )
  values
    (v_cp_grant, v_user_a, v_pkg_grant, 4, now() + interval '20 days', now() - interval '10 days', 'Deferred Pkg Grant', 6, 30),
    (v_cp_fallback, v_user_b, v_pkg_fallback, 3, now() + interval '25 days', now() - interval '9 days', 'Deferred Pkg Fallback', 8, 30),
    (v_cp_conflict, v_user_c, v_pkg_conflict, 2, now() + interval '25 days', now() - interval '8 days', 'Deferred Pkg Conflict', null, 30)
  on conflict (id) do update
    set client_id = excluded.client_id,
        package_id = excluded.package_id,
        credits_left = excluded.credits_left,
        expiry_date = excluded.expiry_date,
        package_name_snapshot = excluded.package_name_snapshot,
        package_credits_snapshot = excluded.package_credits_snapshot,
        package_expiry_days_snapshot = excluded.package_expiry_days_snapshot;

  insert into public.pos_sales (
    id,
    studio_id,
    location_id,
    salon_customer_id,
    status,
    currency,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount,
    paid_at,
    created_by,
    updated_by
  )
  values (
    v_sale_id,
    v_studio_id,
    v_location_id,
    v_customer_a,
    'paid',
    'SGD',
    120,
    0,
    0,
    120,
    now() - interval '7 days',
    v_owner_id,
    v_owner_id
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        salon_customer_id = excluded.salon_customer_id,
        status = excluded.status,
        currency = excluded.currency,
        subtotal_amount = excluded.subtotal_amount,
        discount_amount = excluded.discount_amount,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount,
        paid_at = excluded.paid_at;

  insert into public.pos_sale_items (
    id,
    sale_id,
    studio_id,
    location_id,
    line_number,
    item_type,
    package_id,
    item_name_snapshot,
    item_currency_snapshot,
    quantity,
    unit_price_amount,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount
  )
  values (
    v_item_id,
    v_sale_id,
    v_studio_id,
    v_location_id,
    1,
    'package',
    v_pkg_grant,
    'Deferred Pkg Grant',
    'SGD',
    1,
    120,
    120,
    0,
    0,
    120
  )
  on conflict (id) do update
    set sale_id = excluded.sale_id,
        studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        line_number = excluded.line_number,
        item_type = excluded.item_type,
        package_id = excluded.package_id,
        item_name_snapshot = excluded.item_name_snapshot,
        item_currency_snapshot = excluded.item_currency_snapshot,
        quantity = excluded.quantity,
        unit_price_amount = excluded.unit_price_amount,
        subtotal_amount = excluded.subtotal_amount,
        discount_amount = excluded.discount_amount,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount;

  insert into public.payments (
    id,
    studio_id,
    location_id,
    pos_sale_id,
    amount,
    currency,
    status,
    paid_at,
    source,
    payment_method
  )
  values (
    v_payment_id,
    v_studio_id,
    v_location_id,
    v_sale_id,
    120,
    'SGD',
    'paid',
    now() - interval '7 days',
    'pos_sale',
    'cash'
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        pos_sale_id = excluded.pos_sale_id,
        amount = excluded.amount,
        currency = excluded.currency,
        status = excluded.status,
        paid_at = excluded.paid_at;

  delete from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and source_id in (v_item_id, v_cp_grant)
    and source_type in ('pos_sale_item_grant', 'pos_sale_item_refund');

  insert into public.client_package_ledger_entries (
    studio_id,
    location_id,
    client_package_id,
    salon_customer_id,
    package_id,
    pos_sale_id,
    pos_sale_item_id,
    payment_id,
    event_type,
    source_type,
    source_id,
    delta_credits,
    balance_before,
    balance_after,
    currency,
    value_delta_amount,
    note,
    metadata,
    created_by,
    occurred_at
  )
  values (
    v_studio_id,
    v_location_id,
    v_cp_grant,
    v_customer_a,
    v_pkg_grant,
    v_sale_id,
    v_item_id,
    v_payment_id,
    'purchase_grant',
    'pos_sale_item_grant',
    v_item_id,
    6,
    0,
    6,
    'SGD',
    120,
    'Deferred value verify grant',
    '{}'::jsonb,
    v_owner_id,
    now() - interval '7 days'
  )
  on conflict do nothing;

  delete from public.pkg01_deferred_value_conflicts
  where studio_id = v_studio_id
    and source_client_package_id in (v_cp_grant, v_cp_fallback, v_cp_conflict);

  perform public.get_pkg01_deferred_value(
    p_studio_id := v_studio_id,
    p_customer_id := null,
    p_package_id := null,
    p_as_of := null,
    p_limit := 200,
    p_refresh_conflicts := true,
    p_actor_id := v_owner_id
  );

  select count(*)
  into v_row_count
  from public.get_pkg01_deferred_value(
    p_studio_id := v_studio_id,
    p_customer_id := null,
    p_package_id := null,
    p_as_of := null,
    p_limit := 200,
    p_refresh_conflicts := false,
    p_actor_id := v_owner_id
  );

  if v_row_count <> 2 then
    raise exception 'PKG-01 deferred value expected 2 valid rows, got %', v_row_count;
  end if;

  select unit_price_snapshot, deferred_value
  into v_unit_grant, v_value_grant
  from public.get_pkg01_deferred_value(
    p_studio_id := v_studio_id,
    p_customer_id := v_customer_a,
    p_package_id := v_pkg_grant,
    p_as_of := null,
    p_limit := 10,
    p_refresh_conflicts := false,
    p_actor_id := v_owner_id
  )
  limit 1;

  if v_unit_grant <> 20.000000::numeric or v_value_grant <> 80.00::numeric then
    raise exception 'PKG-01 deferred purchase snapshot expected unit=20 value=80, got unit=% value=%', v_unit_grant, v_value_grant;
  end if;

  select unit_price_snapshot, deferred_value
  into v_unit_fallback, v_value_fallback
  from public.get_pkg01_deferred_value(
    p_studio_id := v_studio_id,
    p_customer_id := v_customer_b,
    p_package_id := v_pkg_fallback,
    p_as_of := null,
    p_limit := 10,
    p_refresh_conflicts := false,
    p_actor_id := v_owner_id
  )
  limit 1;

  if v_unit_fallback <> 25.000000::numeric or v_value_fallback <> 75.00::numeric then
    raise exception 'PKG-01 deferred fallback expected unit=25 value=75, got unit=% value=%', v_unit_fallback, v_value_fallback;
  end if;

  select count(*)
  into v_conflict_open
  from public.pkg01_deferred_value_conflicts c
  where c.studio_id = v_studio_id
    and c.source_client_package_id = v_cp_conflict
    and c.conflict_code = 'missing_unit_price_snapshot'
    and c.status = 'open';

  if v_conflict_open <> 1 then
    raise exception 'PKG-01 deferred expected one open missing_unit_price_snapshot conflict, got %', v_conflict_open;
  end if;

  select
    count(*),
    coalesce(sum(s.total_remaining_credits), 0),
    coalesce(sum(s.total_deferred_value), 0)
  into v_summary_rows, v_summary_credits, v_summary_value
  from public.get_pkg01_deferred_value_summary(
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_customer_id := null,
    p_package_id := null,
    p_as_of := null,
    p_refresh_conflicts := false,
    p_actor_id := v_owner_id
  ) s;

  if v_summary_rows <> 1
     or v_summary_credits <> 7
     or v_summary_value <> 155.00::numeric then
    raise exception 'PKG-01 deferred summary before fix expected rows=1 credits=7 value=155, got rows=% credits=% value=%',
      v_summary_rows, v_summary_credits, v_summary_value;
  end if;

  update public.packages
  set credits = 6
  where id = v_pkg_conflict;

  perform public.get_pkg01_deferred_value(
    p_studio_id := v_studio_id,
    p_customer_id := null,
    p_package_id := null,
    p_as_of := null,
    p_limit := 200,
    p_refresh_conflicts := true,
    p_actor_id := v_owner_id
  );

  select count(*)
  into v_conflict_resolved
  from public.pkg01_deferred_value_conflicts c
  where c.studio_id = v_studio_id
    and c.source_client_package_id = v_cp_conflict
    and c.conflict_code = 'missing_unit_price_snapshot'
    and c.status = 'resolved';

  if v_conflict_resolved <> 1 then
    raise exception 'PKG-01 deferred expected resolved conflict after data fix, got %', v_conflict_resolved;
  end if;

  select
    count(*),
    coalesce(sum(s.total_remaining_credits), 0),
    coalesce(sum(s.total_deferred_value), 0)
  into v_summary_rows, v_summary_credits, v_summary_value
  from public.get_pkg01_deferred_value_summary(
    p_studio_id := v_studio_id,
    p_location_id := v_location_id,
    p_customer_id := null,
    p_package_id := null,
    p_as_of := null,
    p_refresh_conflicts := false,
    p_actor_id := v_owner_id
  ) s;

  if v_summary_rows <> 1
     or v_summary_credits <> 9
     or v_summary_value <> 205.00::numeric then
    raise exception 'PKG-01 deferred summary after fix expected rows=1 credits=9 value=205, got rows=% credits=% value=%',
      v_summary_rows, v_summary_credits, v_summary_value;
  end if;

  raise notice 'verify_pkg01_deferred_value: ok';
end;
$$;
