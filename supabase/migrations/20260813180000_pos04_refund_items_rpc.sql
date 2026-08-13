-- POS-04 Batch 2: line-item / partial refund RPC for POS sales.

create or replace function public.refund_pos_sale_items(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_outcome text;
  v_idempotency_key_id uuid;
  v_idempotency_claim_token uuid;
  v_sale_before public.pos_sales;
  v_sale_after public.pos_sales;
  v_payment_before public.payments;
  v_payment_after public.payments;
  v_item_before public.pos_sale_items;
  v_item_after public.pos_sale_items;
  v_item_input record;
  v_refund_qty numeric(12,3);
  v_refund_amount numeric(12,2);
  v_item_remaining_qty numeric(12,3);
  v_item_remaining_amount numeric(12,2);
  v_line_refund_qty numeric(12,3);
  v_line_refund_amount numeric(12,2);
  v_sale_refund_delta numeric(12,2) := 0;
  v_sale_next_refunded_amount numeric(12,2);
  v_sale_next_status text;
  v_reason text;
  v_now timestamptz;
  v_line_updates jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'request_hash is required' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty items payload' using errcode = '22023';
  end if;

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := p_studio_id,
    p_operation_scope := 'pos_sale:refund_items',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'refund_pos_sale_items idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'refund_pos_sale_items unexpected idempotency outcome: %', v_outcome using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    select *
    into v_sale_before
    from public.pos_sales s
    where s.id = p_sale_id
      and s.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'sale % not found in studio %', p_sale_id, p_studio_id using errcode = 'P0002';
    end if;

    perform public.pos01_assert_actor_scope(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_location_id := v_sale_before.location_id
    );

    if v_sale_before.status <> 'paid' and v_sale_before.status <> 'partially_refunded' then
      raise exception 'sale % status % cannot be refunded by items', p_sale_id, v_sale_before.status using errcode = '23514';
    end if;

    select *
    into v_payment_before
    from public.payments p
    where p.studio_id = p_studio_id
      and p.pos_sale_id = v_sale_before.id
    order by p.created_at desc
    limit 1
    for update;

    if not found then
      raise exception 'payment for sale % not found', p_sale_id using errcode = '23514';
    end if;

    if v_payment_before.status <> 'paid' and v_payment_before.status <> 'refunded' then
      raise exception 'payment % status % not ready for item refund', v_payment_before.id, v_payment_before.status using errcode = '23514';
    end if;

    for v_item_input in
      with parsed as (
        select
          item_id,
          refund_qty,
          refund_amount
        from jsonb_to_recordset(p_items) as x(
          item_id uuid,
          refund_qty numeric,
          refund_amount numeric
        )
      )
      select
        item_id,
        round(sum(coalesce(refund_qty, 0))::numeric, 3) as refund_qty,
        round(sum(coalesce(refund_amount, 0))::numeric, 2) as refund_amount,
        bool_or(refund_qty is not null) as has_qty,
        bool_or(refund_amount is not null) as has_amount
      from parsed
      group by item_id
    loop
      if v_item_input.item_id is null then
        raise exception 'item_id is required for each refund item' using errcode = '22023';
      end if;

      if coalesce(v_item_input.has_qty, false) = coalesce(v_item_input.has_amount, false) then
        raise exception 'each refund item requires exactly one of refund_qty/refund_amount' using errcode = '22023';
      end if;

      select *
      into v_item_before
      from public.pos_sale_items i
      where i.id = v_item_input.item_id
        and i.sale_id = v_sale_before.id
        and i.studio_id = p_studio_id
      for update;

      if not found then
        raise exception 'sale item % not found under sale %', v_item_input.item_id, p_sale_id using errcode = 'P0002';
      end if;

      v_item_remaining_qty := round(coalesce(v_item_before.quantity, 0)::numeric - coalesce(v_item_before.refunded_quantity, 0)::numeric, 3);
      v_item_remaining_amount := round(coalesce(v_item_before.total_amount, 0)::numeric - coalesce(v_item_before.refunded_amount, 0)::numeric, 2);

      if v_item_remaining_amount <= 0 then
        raise exception 'sale item % is already fully refunded', v_item_before.id using errcode = '23514';
      end if;

      if coalesce(v_item_input.has_qty, false) then
        v_refund_qty := round(coalesce(v_item_input.refund_qty, 0)::numeric, 3);
        if v_refund_qty <= 0 then
          raise exception 'refund_qty must be > 0 for item %', v_item_before.id using errcode = '22023';
        end if;
        if v_refund_qty > v_item_remaining_qty + 0.0005 then
          raise exception 'refund_qty exceeds remaining qty for item %', v_item_before.id using errcode = '23514';
        end if;

        v_line_refund_qty := v_refund_qty;
        if coalesce(v_item_before.quantity, 0) <= 0 then
          raise exception 'item % has invalid quantity for refund', v_item_before.id using errcode = '23514';
        end if;

        v_line_refund_amount := round((v_item_before.total_amount / v_item_before.quantity) * v_line_refund_qty, 2);
        if v_line_refund_amount > v_item_remaining_amount then
          v_line_refund_amount := v_item_remaining_amount;
        end if;
      else
        v_refund_amount := round(coalesce(v_item_input.refund_amount, 0)::numeric, 2);
        if v_refund_amount <= 0 then
          raise exception 'refund_amount must be > 0 for item %', v_item_before.id using errcode = '22023';
        end if;
        if v_refund_amount > v_item_remaining_amount + 0.005 then
          raise exception 'refund_amount exceeds remaining amount for item %', v_item_before.id using errcode = '23514';
        end if;

        v_line_refund_amount := v_refund_amount;
        if coalesce(v_item_before.total_amount, 0) > 0 then
          v_line_refund_qty := round((v_item_before.quantity / v_item_before.total_amount) * v_line_refund_amount, 3);
          if v_line_refund_qty > v_item_remaining_qty then
            v_line_refund_qty := v_item_remaining_qty;
          end if;
        else
          v_line_refund_qty := 0;
        end if;
      end if;

      if v_line_refund_amount <= 0 then
        raise exception 'computed refund amount must be > 0 for item %', v_item_before.id using errcode = '23514';
      end if;

      update public.pos_sale_items
      set refunded_quantity = round(coalesce(v_item_before.refunded_quantity, 0)::numeric + v_line_refund_qty, 3),
          refunded_amount = round(coalesce(v_item_before.refunded_amount, 0)::numeric + v_line_refund_amount, 2),
          updated_at = now()
      where id = v_item_before.id
      returning * into v_item_after;

      if coalesce(v_item_after.refunded_amount, 0) > coalesce(v_item_after.total_amount, 0) + 0.005 then
        raise exception 'item % refunded amount overflow', v_item_after.id using errcode = '23514';
      end if;

      if coalesce(v_item_after.refunded_quantity, 0) > coalesce(v_item_after.quantity, 0) + 0.0005 then
        raise exception 'item % refunded quantity overflow', v_item_after.id using errcode = '23514';
      end if;

      v_sale_refund_delta := round(v_sale_refund_delta + v_line_refund_amount, 2);
      v_item_count := v_item_count + 1;
      v_line_updates := v_line_updates || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_after.id,
        'line_number', v_item_after.line_number,
        'refund_qty', v_line_refund_qty,
        'refund_amount', v_line_refund_amount,
        'refunded_quantity', v_item_after.refunded_quantity,
        'refunded_amount', v_item_after.refunded_amount,
        'total_amount', v_item_after.total_amount
      ));
    end loop;

    if v_item_count = 0 then
      raise exception 'empty items payload' using errcode = '22023';
    end if;

    v_sale_next_refunded_amount := round(coalesce(v_sale_before.refunded_amount, 0)::numeric + v_sale_refund_delta, 2);
    if v_sale_next_refunded_amount > coalesce(v_sale_before.total_amount, 0) + 0.005 then
      raise exception 'sale refund exceeds total_amount' using errcode = '23514';
    end if;

    v_sale_next_status := case
      when v_sale_next_refunded_amount >= round(coalesce(v_sale_before.total_amount, 0)::numeric, 2) then 'refunded'
      when v_sale_next_refunded_amount > 0 then 'partially_refunded'
      else 'paid'
    end;

    v_now := now();
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');

    update public.pos_sales
    set refunded_amount = v_sale_next_refunded_amount,
        status = v_sale_next_status,
        updated_by = p_actor_id
    where id = v_sale_before.id
    returning * into v_sale_after;

    if v_sale_after.status = 'refunded' then
      update public.payments
      set status = 'refunded',
          manual_refund_recorded_at = coalesce(manual_refund_recorded_at, v_now),
          manual_refund_recorded_by = coalesce(manual_refund_recorded_by, p_actor_id),
          manual_refund_reference = coalesce(manual_refund_reference, v_reason),
          gateway_status = coalesce(gateway_status, 'pos_item_refund_recorded')
      where id = v_payment_before.id
      returning * into v_payment_after;
    else
      if v_payment_before.status = 'refunded' then
        raise exception 'payment % already refunded while sale % is %', v_payment_before.id, v_sale_after.id, v_sale_after.status using errcode = '23514';
      end if;
      v_payment_after := v_payment_before;
    end if;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_items_refunded',
      p_target_type := 'pos_sale',
      p_actor_type := 'user',
      p_location_id := v_sale_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_sale_before.id,
      p_before_state := jsonb_build_object(
        'sale', to_jsonb(v_sale_before),
        'payment', to_jsonb(v_payment_before)
      ),
      p_after_state := jsonb_build_object(
        'sale', to_jsonb(v_sale_after),
        'payment', to_jsonb(v_payment_after),
        'items', v_line_updates,
        'refund_reason', v_reason,
        'refund_delta', v_sale_refund_delta,
        'from_status', v_sale_before.status,
        'to_status', v_sale_after.status,
        'payment_from_status', v_payment_before.status,
        'payment_to_status', v_payment_after.status
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_after.id,
      'sale_status', v_sale_after.status,
      'refunded_amount', v_sale_after.refunded_amount,
      'refund_delta', v_sale_refund_delta,
      'item_count', v_item_count,
      'payment_id', v_payment_after.id,
      'payment_status', v_payment_after.status,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale:refund_items' using errcode = '23514';
    end if;

    return v_result;
  exception
    when others then
      perform public.fail_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_error_summary := left(sqlerrm, 1000),
        p_retryable := true
      );
      raise;
  end;
end;
$$;

revoke all on function public.refund_pos_sale_items(uuid, text, uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;

grant execute on function public.refund_pos_sale_items(uuid, text, uuid, uuid, jsonb, text, text, text)
  to service_role;
