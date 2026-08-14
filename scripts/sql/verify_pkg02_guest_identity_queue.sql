-- verify_pkg02_guest_identity_queue.sql
-- Validates guest identity strategy for package grant:
--   1) paid package sale with salon_customer.user_id is null does not fail;
--   2) grant is deferred into pkg02 queue;
--   3) linking user_id triggers queue processing and creates purchase_grant.

set check_function_bodies = off;

DO $$
declare
  v_studio_id uuid := 'e1111111-1111-1111-1111-111111111111'::uuid;
  v_location_id uuid := 'e2222222-2222-2222-2222-222222222222'::uuid;
  v_owner_id uuid := 'e3333333-3333-3333-3333-333333333333'::uuid;
  v_cashier_id uuid := 'e4444444-4444-4444-4444-444444444444'::uuid;
  v_registered_user_id uuid := 'e5555555-5555-5555-5555-555555555555'::uuid;
  v_guest_customer_id uuid := 'e6666666-6666-6666-6666-666666666666'::uuid;
  v_package_id uuid := 'e7777777-7777-7777-7777-777777777777'::uuid;
  v_sale_id uuid := 'e8888888-8888-8888-8888-888888888888'::uuid;
  v_item_id uuid := 'e9999999-9999-9999-9999-999999999999'::uuid;
  v_payment_id uuid := 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

  v_complete jsonb;
  v_grant_count integer;
  v_grant_delta integer;
  v_pending_count integer;
  v_resolved_count integer;
  v_client_package_count integer;
begin
  insert into public.users (id, email)
  values
    (v_owner_id, 'owner+pkg02-guest@example.com'),
    (v_cashier_id, 'cashier+pkg02-guest@example.com'),
    (v_registered_user_id, 'registered+pkg02-guest@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, owner_id)
  values (v_studio_id, v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'PKG02 Guest Verify Location')
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
    v_guest_customer_id,
    v_studio_id,
    null,
    'PKG02 Guest Customer',
    'guest+pkg02@example.com',
    'active',
    'walk_in'
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        user_id = null,
        merged_into_id = null,
        email = excluded.email;

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
    'PKG02 Guest Package',
    60,
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
    updated_by,
    refunded_amount
  )
  values (
    v_sale_id,
    v_studio_id,
    v_location_id,
    v_guest_customer_id,
    v_cashier_id,
    'pending_payment',
    'SGD',
    60,
    0,
    0,
    60,
    v_cashier_id,
    v_cashier_id,
    0
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
    total_amount,
    refunded_quantity,
    refunded_amount
  )
  values (
    v_item_id,
    v_sale_id,
    v_studio_id,
    v_location_id,
    1,
    'package',
    v_package_id,
    'PKG02 Guest Package',
    'SGD',
    1,
    60,
    60,
    0,
    0,
    60,
    0,
    0
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
    null,
    60,
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
  delete from public.client_packages where package_id = v_package_id;
  delete from public.pkg02_guest_package_grant_queue where studio_id = v_studio_id and pos_sale_item_id = v_item_id;

  v_complete := public.complete_pos_cash_sale(
    p_actor_id := v_cashier_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_sale_id := v_sale_id,
    p_idempotency_key := 'pkg02-guest-verify-complete-1',
    p_request_hash := 'pkg02-guest-verify-complete-hash-1'
  );

  if coalesce((v_complete->>'ok')::boolean, false) is false
     or coalesce(v_complete->>'sale_status', '') <> 'paid' then
    raise exception 'PKG-02 guest verify complete_pos_cash_sale failed: %', v_complete;
  end if;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_grant_count, v_grant_delta
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and pos_sale_id = v_sale_id
    and event_type = 'purchase_grant';

  if v_grant_count <> 0 or v_grant_delta <> 0 then
    raise exception 'PKG-02 guest verify expected no immediate grant before user link, got count=% delta=%',
      v_grant_count, v_grant_delta;
  end if;

  select count(*)
  into v_pending_count
  from public.pkg02_guest_package_grant_queue q
  where q.studio_id = v_studio_id
    and q.pos_sale_item_id = v_item_id
    and q.status = 'pending';

  if v_pending_count <> 1 then
    raise exception 'PKG-02 guest verify expected one pending deferred grant row, got %', v_pending_count;
  end if;

  update public.salon_customers
  set user_id = v_registered_user_id
  where id = v_guest_customer_id;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_grant_count, v_grant_delta
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and pos_sale_id = v_sale_id
    and event_type = 'purchase_grant';

  if v_grant_count <> 1 or v_grant_delta <> 6 then
    raise exception 'PKG-02 guest verify expected linked grant count=1 delta=6, got count=% delta=%',
      v_grant_count, v_grant_delta;
  end if;

  select count(*)
  into v_client_package_count
  from public.client_packages cp
  where cp.package_id = v_package_id
    and cp.client_id = v_registered_user_id;

  if v_client_package_count <> 1 then
    raise exception 'PKG-02 guest verify expected one client_package for linked user, got %', v_client_package_count;
  end if;

  select count(*)
  into v_resolved_count
  from public.pkg02_guest_package_grant_queue q
  where q.studio_id = v_studio_id
    and q.pos_sale_item_id = v_item_id
    and q.status = 'resolved';

  if v_resolved_count <> 1 then
    raise exception 'PKG-02 guest verify expected resolved deferred grant row, got %', v_resolved_count;
  end if;

  raise notice 'verify_pkg02_guest_identity_queue: ok';
end;
$$;

