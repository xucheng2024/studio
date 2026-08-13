-- verify_pkg01_pos_minimal.sql
-- Validates PKG-01 minimal POS linkage:
--   1) paid package sale creates purchase_grant + client_package credits
--   2) full-item refund creates refund_reversal + credits rollback

set check_function_bodies = off;

DO $$
declare
  v_studio_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  v_location_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  v_owner_id uuid := '33333333-3333-3333-3333-333333333333'::uuid;
  v_cashier_id uuid := '44444444-4444-4444-4444-444444444444'::uuid;
  v_customer_user_id uuid := '55555555-5555-5555-5555-555555555555'::uuid;
  v_customer_id uuid := '66666666-6666-6666-6666-666666666666'::uuid;
  v_package_id uuid := '77777777-7777-7777-7777-777777777777'::uuid;
  v_sale_id uuid := '88888888-8888-8888-8888-888888888888'::uuid;
  v_item_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  v_payment_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

  v_complete jsonb;
  v_refund jsonb;
  v_client_package_id uuid;
  v_credits_left integer;
  v_grant_count integer;
  v_reversal_count integer;
  v_grant_delta integer;
  v_reversal_delta integer;
begin
  insert into public.users (id, email)
  values
    (v_owner_id, 'owner+pkg01@example.com'),
    (v_cashier_id, 'cashier+pkg01@example.com'),
    (v_customer_user_id, 'customer+pkg01@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, owner_id)
  values (v_studio_id, v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'PKG01 Verify Location')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.staff_memberships (studio_id, user_id, location_id, role, is_active)
  values (v_studio_id, v_cashier_id, v_location_id, 'frontdesk', true)
  on conflict do nothing;

  insert into public.salon_customers (
    id,
    studio_id,
    user_id,
    full_name,
    email,
    status,
    source
  )
  values (
    v_customer_id,
    v_studio_id,
    v_customer_user_id,
    'PKG01 Verify Customer',
    'customer+pkg01@example.com',
    'active',
    'frontdesk'
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        user_id = excluded.user_id;

  insert into public.packages (
    id,
    studio_id,
    name,
    price,
    credits,
    expiry_days,
    is_active
  )
  values (
    v_package_id,
    v_studio_id,
    'PKG01 Verify Package',
    120,
    6,
    30,
    true
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        credits = excluded.credits,
        expiry_days = excluded.expiry_days,
        price = excluded.price,
        is_active = excluded.is_active;

  insert into public.pos_sales (
    id,
    studio_id,
    location_id,
    salon_customer_id,
    cashier_user_id,
    status,
    currency,
    subtotal_amount,
    discount_amount,
    tax_amount,
    total_amount,
    created_by,
    updated_by
  )
  values (
    v_sale_id,
    v_studio_id,
    v_location_id,
    v_customer_id,
    v_cashier_id,
    'pending_payment',
    'SGD',
    120,
    0,
    0,
    120,
    v_cashier_id,
    v_cashier_id
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        salon_customer_id = excluded.salon_customer_id,
        cashier_user_id = excluded.cashier_user_id,
        status = excluded.status,
        subtotal_amount = excluded.subtotal_amount,
        discount_amount = excluded.discount_amount,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount,
        updated_by = excluded.updated_by,
        refunded_amount = 0;

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
    v_package_id,
    'PKG01 Verify Package',
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
        quantity = excluded.quantity,
        unit_price_amount = excluded.unit_price_amount,
        subtotal_amount = excluded.subtotal_amount,
        discount_amount = excluded.discount_amount,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount,
        refunded_quantity = 0,
        refunded_amount = 0;

  insert into public.payments (
    id,
    studio_id,
    location_id,
    client_id,
    amount,
    type,
    status,
    currency,
    payment_method,
    source,
    pos_sale_id
  )
  values (
    v_payment_id,
    v_studio_id,
    v_location_id,
    v_customer_user_id,
    120,
    'package',
    'pending',
    'SGD',
    'cash',
    'pos_sale',
    v_sale_id
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        client_id = excluded.client_id,
        amount = excluded.amount,
        type = excluded.type,
        status = 'pending',
        currency = excluded.currency,
        payment_method = excluded.payment_method,
        source = excluded.source,
        pos_sale_id = excluded.pos_sale_id,
        manual_refund_recorded_at = null,
        manual_refund_recorded_by = null,
        manual_refund_reference = null;

  delete from public.client_package_ledger_entries where studio_id = v_studio_id and pos_sale_id = v_sale_id;
  delete from public.client_packages where client_id = v_customer_user_id and package_id = v_package_id;

  v_complete := public.complete_pos_cash_sale(
    p_actor_id := v_cashier_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := 'pkg01-verify-complete-1',
    p_request_hash := 'pkg01-verify-complete-hash-1'
  );

  if coalesce((v_complete->>'ok')::boolean, false) is false
     or coalesce(v_complete->>'sale_status', '') <> 'paid' then
    raise exception 'PKG-01 verify complete_pos_cash_sale failed: %', v_complete;
  end if;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_grant_count, v_grant_delta
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and pos_sale_id = v_sale_id
    and event_type = 'purchase_grant';

  if v_grant_count <> 1 or v_grant_delta <> 6 then
    raise exception 'PKG-01 verify expected 1 purchase_grant(+6), got count=% delta=%', v_grant_count, v_grant_delta;
  end if;

  select cp.id, cp.credits_left
  into v_client_package_id, v_credits_left
  from public.client_packages cp
  where cp.client_id = v_customer_user_id
    and cp.package_id = v_package_id
  order by cp.created_at desc
  limit 1;

  if v_client_package_id is null or v_credits_left <> 6 then
    raise exception 'PKG-01 verify expected client_package credits_left=6, got id=% credits=%', v_client_package_id, v_credits_left;
  end if;

  v_refund := public.refund_pos_sale_items(
    p_actor_id := v_cashier_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_items := jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'refund_qty', 1)),
    p_reason := 'PKG01 verify full refund',
    p_idempotency_key := 'pkg01-verify-refund-1',
    p_request_hash := 'pkg01-verify-refund-hash-1'
  );

  if coalesce((v_refund->>'ok')::boolean, false) is false then
    raise exception 'PKG-01 verify refund_pos_sale_items failed: %', v_refund;
  end if;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_reversal_count, v_reversal_delta
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and pos_sale_id = v_sale_id
    and event_type = 'refund_reversal';

  if v_reversal_count <> 1 or v_reversal_delta <> -6 then
    raise exception 'PKG-01 verify expected 1 refund_reversal(-6), got count=% delta=%', v_reversal_count, v_reversal_delta;
  end if;

  select credits_left
  into v_credits_left
  from public.client_packages
  where id = v_client_package_id;

  if v_credits_left <> 0 then
    raise exception 'PKG-01 verify expected client_package credits_left=0 after reversal, got %', v_credits_left;
  end if;

  raise notice 'verify_pkg01_pos_minimal: ok';
end;
$$;
