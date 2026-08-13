-- PKG-01 batch 2: minimal POS linkage for purchase grant and refund reversal.
-- Scope:
--   * helper RPCs to write package ledger + client_packages balance atomically
--   * trigger hooks from POS status/refund updates (cash/hitpay/refund RPC compatible)
--   * keep FND-04 strong audit references (idempotency id optional when trigger-driven)

create or replace function public.pkg01_apply_sale_package_grants(
  p_studio_id uuid,
  p_sale_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_idempotency_key_id uuid default null,
  p_provider_event_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale public.pos_sales;
  v_payment public.payments;
  v_item public.pos_sale_items;
  v_package public.packages;
  v_customer public.salon_customers;
  v_existing public.client_package_ledger_entries;
  v_client_package_id uuid;
  v_qty_int integer;
  v_delta_credits integer;
  v_expiry_at timestamptz;
  v_audit_id uuid;
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_grants jsonb := '[]'::jsonb;
  v_row_id uuid;
  v_actor_type text := case when coalesce(p_actor_role, '') = 'hitpay_webhook' then 'system' else 'user' end;
begin
  select *
  into v_sale
  from public.pos_sales s
  where s.id = p_sale_id
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale % not found in studio %', p_sale_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_sale.status <> 'paid' and v_sale.status <> 'partially_refunded' and v_sale.status <> 'refunded' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_not_paid');
  end if;

  if v_sale.salon_customer_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_without_salon_customer');
  end if;

  select *
  into v_customer
  from public.salon_customers c
  where c.id = v_sale.salon_customer_id
    and c.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale customer % not found in studio %', v_sale.salon_customer_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_customer.user_id is null then
    raise exception 'sale customer % is not linked to an authenticated user; cannot grant package credits', v_customer.id
      using errcode = '23514';
  end if;

  select *
  into v_payment
  from public.payments p
  where p.studio_id = p_studio_id
    and p.pos_sale_id = p_sale_id
  order by p.created_at desc
  limit 1;

  for v_item in
    select *
    from public.pos_sale_items i
    where i.sale_id = p_sale_id
      and i.studio_id = p_studio_id
      and i.item_type = 'package'
    order by i.line_number, i.id
  loop
    select *
    into v_existing
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'purchase_grant'
      and le.source_type = 'pos_sale_item_grant'
      and le.source_id = v_item.id
    order by le.created_at asc
    limit 1;

    if found then
      continue;
    end if;

    select *
    into v_package
    from public.packages pkg
    where pkg.id = v_item.package_id
      and pkg.studio_id = p_studio_id;

    if not found then
      raise exception 'package % not found in studio %', v_item.package_id, p_studio_id using errcode = 'P0002';
    end if;

    if round(coalesce(v_item.quantity, 0)::numeric, 3) <> trunc(coalesce(v_item.quantity, 0)) then
      raise exception 'package sale item % quantity must be an integer to grant credits', v_item.id using errcode = '23514';
    end if;

    v_qty_int := trunc(v_item.quantity);
    if v_qty_int <= 0 then
      raise exception 'package sale item % quantity must be > 0', v_item.id using errcode = '23514';
    end if;

    v_delta_credits := v_package.credits * v_qty_int;
    if v_delta_credits <= 0 then
      raise exception 'computed package grant credits must be > 0 for item %', v_item.id using errcode = '23514';
    end if;

    v_expiry_at := case
      when v_package.expiry_days is null then null
      else coalesce(v_sale.paid_at, now()) + make_interval(days => v_package.expiry_days)
    end;

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
    ) values (
      gen_random_uuid(),
      v_customer.user_id,
      v_package.id,
      v_delta_credits,
      v_expiry_at,
      now(),
      coalesce(v_item.item_name_snapshot, v_package.name),
      v_package.credits,
      v_package.expiry_days
    )
    returning id into v_client_package_id;

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
      idempotency_key_id,
      created_by,
      occurred_at
    ) values (
      p_studio_id,
      v_sale.location_id,
      v_client_package_id,
      v_sale.salon_customer_id,
      v_package.id,
      v_sale.id,
      v_item.id,
      v_payment.id,
      'purchase_grant',
      'pos_sale_item_grant',
      v_item.id,
      v_delta_credits,
      0,
      v_delta_credits,
      v_sale.currency,
      round(coalesce(v_item.total_amount, 0)::numeric, 2),
      'POS package sale paid grant',
      jsonb_build_object(
        'saleId', v_sale.id,
        'saleItemId', v_item.id,
        'quantity', v_item.quantity,
        'packageCreditsPerUnit', v_package.credits
      ),
      p_idempotency_key_id,
      p_actor_id,
      coalesce(v_sale.paid_at, now())
    )
    returning id into v_row_id;

    v_inserted_ids := array_append(v_inserted_ids, v_row_id);
    v_grants := v_grants || jsonb_build_array(jsonb_build_object(
      'saleItemId', v_item.id,
      'clientPackageId', v_client_package_id,
      'deltaCredits', v_delta_credits,
      'packageId', v_package.id
    ));
  end loop;

  if cardinality(v_inserted_ids) = 0 then
    return jsonb_build_object('ok', true, 'grants_created', 0, 'already_processed', true);
  end if;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pkg01_package_grant_applied',
    p_target_type := 'pos_sale',
    p_actor_type := v_actor_type,
    p_location_id := v_sale.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_sale.id,
    p_before_state := jsonb_build_object(
      'saleId', v_sale.id,
      'status', v_sale.status
    ),
    p_after_state := jsonb_build_object(
      'saleId', v_sale.id,
      'grants', v_grants
    ),
    p_correlation_id := p_correlation_id,
    p_idempotency_key_id := p_idempotency_key_id,
    p_provider_event_id := p_provider_event_id
  );

  return jsonb_build_object(
    'ok', true,
    'grants_created', cardinality(v_inserted_ids),
    'audit_log_id', v_audit_id
  );
end;
$$;

revoke all on function public.pkg01_apply_sale_package_grants(uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.pkg01_apply_sale_package_grants(uuid, uuid, uuid, text, uuid, uuid, text)
  to service_role;

create or replace function public.pkg01_apply_sale_package_refund_reversals(
  p_studio_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_actor_id uuid,
  p_actor_role text,
  p_reason text default null,
  p_idempotency_key_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale public.pos_sales;
  v_payment public.payments;
  v_item_input record;
  v_item public.pos_sale_items;
  v_grant public.client_package_ledger_entries;
  v_existing_refund public.client_package_ledger_entries;
  v_client_package public.client_packages;
  v_refund_qty numeric(12,3);
  v_balance_before integer;
  v_balance_after integer;
  v_reversal_credits integer;
  v_audit_id uuid;
  v_actor_type text := 'user';
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_reversals jsonb := '[]'::jsonb;
  v_row_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'p_items must be a JSON array' using errcode = '22023';
  end if;

  select *
  into v_sale
  from public.pos_sales s
  where s.id = p_sale_id
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale % not found in studio %', p_sale_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_sale.status <> 'partially_refunded' and v_sale.status <> 'refunded' and v_sale.status <> 'paid' then
    return jsonb_build_object('ok', true, 'reversals_created', 0, 'skipped', true, 'reason', 'sale_not_refundable_state');
  end if;

  select *
  into v_payment
  from public.payments p
  where p.studio_id = p_studio_id
    and p.pos_sale_id = p_sale_id
  order by p.created_at desc
  limit 1;

  for v_item_input in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if (v_item_input.value->>'item_id') is null then
      continue;
    end if;

    select *
    into v_item
    from public.pos_sale_items i
    where i.id = (v_item_input.value->>'item_id')::uuid
      and i.sale_id = p_sale_id
      and i.studio_id = p_studio_id
    for update;

    if not found or v_item.item_type <> 'package' then
      continue;
    end if;

    v_refund_qty := round(coalesce((v_item_input.value->>'refund_qty')::numeric, 0)::numeric, 3);
    if v_refund_qty <= 0 then
      raise exception 'package refund item % must provide refund_qty > 0', v_item.id using errcode = '23514';
    end if;

    if round(v_refund_qty::numeric, 3) <> trunc(v_refund_qty) then
      raise exception 'package refund item % refund_qty must be integer', v_item.id using errcode = '23514';
    end if;

    if round(coalesce(v_item.quantity, 0)::numeric, 3) <> trunc(coalesce(v_item.quantity, 0)) then
      raise exception 'package sale item % quantity must be integer', v_item.id using errcode = '23514';
    end if;

    if v_refund_qty <> trunc(v_item.quantity) then
      raise exception 'partial package refund is not supported in PKG-01 minimal closure for item %', v_item.id using errcode = '23514';
    end if;

    if round(coalesce(v_item.refunded_quantity, 0)::numeric, 3) <> round(coalesce(v_item.quantity, 0)::numeric, 3) then
      raise exception 'package refund reversal requires fully refunded item %, got refunded_quantity=% quantity=%',
        v_item.id, v_item.refunded_quantity, v_item.quantity using errcode = '23514';
    end if;

    select *
    into v_grant
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'purchase_grant'
      and le.source_type = 'pos_sale_item_grant'
      and le.source_id = v_item.id
    order by le.created_at asc
    limit 1
    for update;

    if not found then
      continue;
    end if;

    select *
    into v_existing_refund
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'refund_reversal'
      and le.source_type = 'pos_sale_item_refund'
      and le.source_id = v_item.id
      and le.client_package_id = v_grant.client_package_id
    limit 1;

    if found then
      continue;
    end if;

    v_reversal_credits := abs(coalesce(v_grant.delta_credits, 0));
    if v_reversal_credits <= 0 then
      continue;
    end if;

    select *
    into v_client_package
    from public.client_packages cp
    where cp.id = v_grant.client_package_id
    for update;

    if not found then
      raise exception 'client package % not found for grant item %', v_grant.client_package_id, v_item.id
        using errcode = 'P0002';
    end if;

    if coalesce(v_client_package.credits_left, 0) < v_reversal_credits then
      raise exception 'insufficient package credits to reverse for item %: credits_left=% required=%',
        v_item.id, v_client_package.credits_left, v_reversal_credits using errcode = '23514';
    end if;

    v_balance_before := v_client_package.credits_left;
    v_balance_after := v_balance_before - v_reversal_credits;

    update public.client_packages
    set credits_left = v_balance_after
    where id = v_client_package.id;

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
      idempotency_key_id,
      created_by,
      occurred_at
    ) values (
      p_studio_id,
      v_sale.location_id,
      v_grant.client_package_id,
      v_grant.salon_customer_id,
      v_grant.package_id,
      v_sale.id,
      v_item.id,
      v_payment.id,
      'refund_reversal',
      'pos_sale_item_refund',
      v_item.id,
      -v_reversal_credits,
      v_balance_before,
      v_balance_after,
      v_sale.currency,
      -round(coalesce(v_item.total_amount, 0)::numeric, 2),
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'POS package refund reversal'),
      jsonb_build_object(
        'saleId', v_sale.id,
        'saleItemId', v_item.id,
        'refundQty', v_refund_qty,
        'fullItemRefundOnly', true,
        'grantLedgerId', v_grant.id
      ),
      p_idempotency_key_id,
      p_actor_id,
      now()
    )
    returning id into v_row_id;

    v_inserted_ids := array_append(v_inserted_ids, v_row_id);
    v_reversals := v_reversals || jsonb_build_array(jsonb_build_object(
      'saleItemId', v_item.id,
      'clientPackageId', v_grant.client_package_id,
      'reversalCredits', v_reversal_credits,
      'balanceBefore', v_balance_before,
      'balanceAfter', v_balance_after
    ));
  end loop;

  if cardinality(v_inserted_ids) = 0 then
    return jsonb_build_object('ok', true, 'reversals_created', 0, 'already_processed', true);
  end if;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pkg01_package_refund_reversal_applied',
    p_target_type := 'pos_sale',
    p_actor_type := v_actor_type,
    p_location_id := v_sale.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_sale.id,
    p_before_state := jsonb_build_object(
      'saleId', v_sale.id,
      'status', v_sale.status
    ),
    p_after_state := jsonb_build_object(
      'saleId', v_sale.id,
      'reversals', v_reversals,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    ),
    p_correlation_id := p_correlation_id,
    p_idempotency_key_id := p_idempotency_key_id
  );

  return jsonb_build_object(
    'ok', true,
    'reversals_created', cardinality(v_inserted_ids),
    'audit_log_id', v_audit_id
  );
end;
$$;

revoke all on function public.pkg01_apply_sale_package_refund_reversals(uuid, uuid, jsonb, uuid, text, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.pkg01_apply_sale_package_refund_reversals(uuid, uuid, jsonb, uuid, text, text, uuid, text)
  to service_role;

create or replace function public.pkg01_on_pos_sale_paid_apply_grants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'paid' then
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.status, '') = 'paid' then
    return new;
  end if;

  perform public.pkg01_apply_sale_package_grants(
    p_studio_id := new.studio_id,
    p_sale_id := new.id,
    p_actor_id := coalesce(new.updated_by, new.created_by),
    p_actor_role := 'pos_sale_status_trigger'
  );

  return new;
end;
$$;

drop trigger if exists pkg01_on_pos_sale_paid_apply_grants_trg on public.pos_sales;
create trigger pkg01_on_pos_sale_paid_apply_grants_trg
  after update of status on public.pos_sales
  for each row execute function public.pkg01_on_pos_sale_paid_apply_grants();

create or replace function public.pkg01_on_pos_sale_refunded_apply_reversals()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
begin
  if coalesce(new.refunded_amount, 0) <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(new.refunded_amount, 0) = coalesce(old.refunded_amount, 0)
     and coalesce(new.status, '') = coalesce(old.status, '') then
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id,
    'refund_qty', i.quantity
  )), '[]'::jsonb)
  into v_items
  from public.pos_sale_items i
  left join public.client_package_ledger_entries le
    on le.studio_id = i.studio_id
   and le.event_type = 'refund_reversal'
   and le.source_type = 'pos_sale_item_refund'
   and le.source_id = i.id
  where i.sale_id = new.id
    and i.studio_id = new.studio_id
    and i.item_type = 'package'
    and round(coalesce(i.refunded_quantity, 0)::numeric, 3) = round(coalesce(i.quantity, 0)::numeric, 3)
    and le.id is null;

  if jsonb_array_length(coalesce(v_items, '[]'::jsonb)) = 0 then
    return new;
  end if;

  perform public.pkg01_apply_sale_package_refund_reversals(
    p_studio_id := new.studio_id,
    p_sale_id := new.id,
    p_items := v_items,
    p_actor_id := coalesce(new.updated_by, new.created_by),
    p_actor_role := 'pos_sale_refund_trigger'
  );

  return new;
end;
$$;

drop trigger if exists pkg01_on_pos_sale_refunded_apply_reversals_trg on public.pos_sales;
create trigger pkg01_on_pos_sale_refunded_apply_reversals_trg
  after update of refunded_amount, status on public.pos_sales
  for each row execute function public.pkg01_on_pos_sale_refunded_apply_reversals();
