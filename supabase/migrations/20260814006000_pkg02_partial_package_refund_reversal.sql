-- PKG-02 prep: support partial package refund reversals with proportional ledger deltas.

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
  v_item_total_qty numeric(12,3);
  v_item_refunded_qty numeric(12,3);
  v_item_total_amount numeric(12,2);
  v_item_refunded_amount numeric(12,2);
  v_grant_credits integer;
  v_grant_value_abs numeric(12,2);
  v_target_reversal_credits integer;
  v_target_reversal_value numeric(12,2);
  v_already_reversed_credits integer;
  v_already_reversed_value numeric(12,2);
  v_reversal_credits integer;
  v_reversal_value numeric(12,2);
  v_balance_before integer;
  v_balance_after integer;
  v_checkpoint_seed text;
  v_checkpoint_hash text;
  v_checkpoint_source_id uuid;
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

    if (v_item_input.value->>'refund_qty') is not null then
      v_refund_qty := round(coalesce((v_item_input.value->>'refund_qty')::numeric, 0)::numeric, 3);
      if v_refund_qty <= 0 then
        raise exception 'package refund item % must provide refund_qty > 0', v_item.id using errcode = '23514';
      end if;
      if round(v_refund_qty::numeric, 3) <> trunc(v_refund_qty) then
        raise exception 'package refund item % refund_qty must be integer', v_item.id using errcode = '23514';
      end if;
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

    v_item_total_qty := round(greatest(coalesce(v_item.quantity, 0)::numeric, 0)::numeric, 3);
    if v_item_total_qty <= 0 then
      raise exception 'package sale item % quantity must be > 0', v_item.id using errcode = '23514';
    end if;

    v_item_refunded_qty := round(greatest(coalesce(v_item.refunded_quantity, 0)::numeric, 0)::numeric, 3);
    if v_item_refunded_qty > v_item_total_qty then
      v_item_refunded_qty := v_item_total_qty;
    end if;

    v_item_total_amount := round(greatest(coalesce(v_item.total_amount, 0)::numeric, 0)::numeric, 2);
    v_item_refunded_amount := round(greatest(coalesce(v_item.refunded_amount, 0)::numeric, 0)::numeric, 2);
    if v_item_refunded_amount > v_item_total_amount then
      v_item_refunded_amount := v_item_total_amount;
    end if;

    if v_item_refunded_qty <= 0 and v_item_refunded_amount <= 0 then
      continue;
    end if;

    v_grant_credits := abs(coalesce(v_grant.delta_credits, 0));
    if v_grant_credits <= 0 then
      continue;
    end if;

    v_grant_value_abs := round(
      abs(coalesce(v_grant.value_delta_amount, v_item_total_amount, 0)::numeric),
      2
    );

    if v_item_refunded_qty >= v_item_total_qty - 0.0005 then
      v_target_reversal_credits := v_grant_credits;
    else
      v_target_reversal_credits := trunc((v_grant_credits::numeric * v_item_refunded_qty) / v_item_total_qty);
    end if;

    if v_target_reversal_credits < 0 then
      v_target_reversal_credits := 0;
    elsif v_target_reversal_credits > v_grant_credits then
      v_target_reversal_credits := v_grant_credits;
    end if;

    if v_grant_value_abs <= 0 then
      v_target_reversal_value := 0;
    elsif v_item_total_amount > 0 then
      if v_item_refunded_amount >= v_item_total_amount - 0.005 then
        v_target_reversal_value := v_grant_value_abs;
      else
        v_target_reversal_value := round((v_grant_value_abs * v_item_refunded_amount) / v_item_total_amount, 2);
      end if;
    elsif v_item_refunded_qty >= v_item_total_qty - 0.0005 then
      v_target_reversal_value := v_grant_value_abs;
    else
      v_target_reversal_value := round((v_grant_value_abs * v_item_refunded_qty) / v_item_total_qty, 2);
    end if;

    if v_target_reversal_value < 0 then
      v_target_reversal_value := 0;
    elsif v_target_reversal_value > v_grant_value_abs then
      v_target_reversal_value := v_grant_value_abs;
    end if;

    select
      coalesce(sum(abs(le.delta_credits)), 0)::integer,
      round(coalesce(sum(abs(coalesce(le.value_delta_amount, 0))), 0)::numeric, 2)
    into v_already_reversed_credits, v_already_reversed_value
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'refund_reversal'
      and le.pos_sale_item_id = v_item.id
      and le.client_package_id = v_grant.client_package_id
      and le.source_type = any (array[
        'pos_sale_item_refund'::text,
        'pos_sale_item_refund_checkpoint'::text
      ]);

    v_reversal_credits := v_target_reversal_credits - coalesce(v_already_reversed_credits, 0);
    v_reversal_value := round(v_target_reversal_value - coalesce(v_already_reversed_value, 0), 2);

    if v_reversal_credits <= 0 then
      continue;
    end if;

    if v_reversal_value < 0 then
      v_reversal_value := 0;
    end if;

    v_checkpoint_seed := concat_ws(
      '|',
      v_item.id::text,
      to_char(v_item_refunded_qty, 'FM9999999999990.000'),
      to_char(v_item_refunded_amount, 'FM9999999999990.00')
    );
    v_checkpoint_hash := md5(v_checkpoint_seed);
    v_checkpoint_source_id := (
      substr(v_checkpoint_hash, 1, 8) || '-' ||
      substr(v_checkpoint_hash, 9, 4) || '-' ||
      substr(v_checkpoint_hash, 13, 4) || '-' ||
      substr(v_checkpoint_hash, 17, 4) || '-' ||
      substr(v_checkpoint_hash, 21, 12)
    )::uuid;

    select *
    into v_existing_refund
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'refund_reversal'
      and le.source_type = 'pos_sale_item_refund_checkpoint'
      and le.source_id = v_checkpoint_source_id
      and le.client_package_id = v_grant.client_package_id
    limit 1;

    if found then
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
      'pos_sale_item_refund_checkpoint',
      v_checkpoint_source_id,
      -v_reversal_credits,
      v_balance_before,
      v_balance_after,
      v_sale.currency,
      -v_reversal_value,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'POS package refund reversal'),
      jsonb_build_object(
        'saleId', v_sale.id,
        'saleItemId', v_item.id,
        'refundQtyInput', v_refund_qty,
        'itemRefundedQuantity', v_item_refunded_qty,
        'itemQuantity', v_item_total_qty,
        'itemRefundedAmount', v_item_refunded_amount,
        'itemTotalAmount', v_item_total_amount,
        'targetReversalCredits', v_target_reversal_credits,
        'alreadyReversedCredits', v_already_reversed_credits,
        'appliedReversalCredits', v_reversal_credits,
        'targetReversalValue', v_target_reversal_value,
        'alreadyReversedValue', v_already_reversed_value,
        'appliedReversalValue', v_reversal_value,
        'grantLedgerId', v_grant.id,
        'checkpointSourceId', v_checkpoint_source_id,
        'partialRefundSupported', true
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
      'reversalValue', v_reversal_value,
      'balanceBefore', v_balance_before,
      'balanceAfter', v_balance_after,
      'checkpointSourceId', v_checkpoint_source_id
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
    'refund_qty', greatest(round(coalesce(i.refunded_quantity, 0)::numeric, 3), 0)
  )), '[]'::jsonb)
  into v_items
  from public.pos_sale_items i
  where i.sale_id = new.id
    and i.studio_id = new.studio_id
    and i.item_type = 'package'
    and (
      coalesce(i.refunded_quantity, 0) > 0
      or coalesce(i.refunded_amount, 0) > 0
    );

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

