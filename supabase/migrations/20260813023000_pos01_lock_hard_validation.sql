-- POS-01 batch 5: hard pre-lock validations for submit boundary.
-- Scope:
--   * lock_pos_sale hard checks before status transition
--   * reject empty sale, item snapshot/currency issues, and sale-vs-item totals mismatch

create or replace function public.lock_pos_sale(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_id uuid,
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
  v_before public.pos_sales;
  v_after public.pos_sales;
  v_result jsonb;
  v_item_count integer := 0;
  v_item_subtotal numeric(12,2) := 0;
  v_item_discount numeric(12,2) := 0;
  v_item_tax numeric(12,2) := 0;
  v_item_total numeric(12,2) := 0;
  v_bad_item_name_count integer := 0;
  v_currency_mismatch_count integer := 0;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'request_hash is required' using errcode = '22023';
  end if;

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := p_studio_id,
    p_operation_scope := 'pos_sale:lock',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'lock_pos_sale idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'lock_pos_sale unexpected idempotency outcome: %', v_outcome using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    select *
    into v_before
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
      p_location_id := v_before.location_id
    );

    if v_before.status <> 'draft' then
      raise exception 'sale % status % cannot be locked', p_sale_id, v_before.status using errcode = '23514';
    end if;

    if v_before.locked_at is not null then
      v_result := jsonb_build_object(
        'ok', true,
        'sale_id', v_before.id,
        'status', v_before.status,
        'locked_at', v_before.locked_at,
        'already_locked', true,
        'already_completed', false
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for pos_sale:lock' using errcode = '23514';
      end if;

      return v_result;
    end if;

    select
      count(*)::integer,
      coalesce(round(sum(i.subtotal_amount)::numeric, 2), 0),
      coalesce(round(sum(i.discount_amount)::numeric, 2), 0),
      coalesce(round(sum(i.tax_amount)::numeric, 2), 0),
      coalesce(round(sum(i.total_amount)::numeric, 2), 0),
      count(*) filter (where nullif(btrim(coalesce(i.item_name_snapshot, '')), '') is null)::integer,
      count(*) filter (where i.item_currency_snapshot <> v_before.currency)::integer
    into
      v_item_count,
      v_item_subtotal,
      v_item_discount,
      v_item_tax,
      v_item_total,
      v_bad_item_name_count,
      v_currency_mismatch_count
    from public.pos_sale_items i
    where i.sale_id = v_before.id;

    if v_item_count = 0 then
      raise exception 'sale % cannot be locked with empty items', p_sale_id using errcode = '23514';
    end if;

    if v_bad_item_name_count > 0 then
      raise exception 'sale % has item with missing snapshot name', p_sale_id using errcode = '23514';
    end if;

    if v_currency_mismatch_count > 0 then
      raise exception 'sale % has item currency mismatch with sale currency %', p_sale_id, v_before.currency
        using errcode = '23514';
    end if;

    if round(v_before.subtotal_amount::numeric, 2) <> v_item_subtotal
      or round(v_before.discount_amount::numeric, 2) <> v_item_discount
      or round(v_before.tax_amount::numeric, 2) <> v_item_tax
      or round(v_before.total_amount::numeric, 2) <> v_item_total then
      raise exception
        'sale % totals mismatch before lock: sale(subtotal=% discount=% tax=% total=%) items(subtotal=% discount=% tax=% total=%)',
        p_sale_id,
        v_before.subtotal_amount,
        v_before.discount_amount,
        v_before.tax_amount,
        v_before.total_amount,
        v_item_subtotal,
        v_item_discount,
        v_item_tax,
        v_item_total
        using errcode = '23514';
    end if;

    update public.pos_sales
    set status = 'pending_payment',
        locked_at = now(),
        submitted_at = now(),
        updated_by = p_actor_id
    where id = v_before.id
    returning * into v_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_locked',
      p_target_type := 'pos_sale',
      p_actor_type := 'user',
      p_location_id := v_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_before.id,
      p_before_state := to_jsonb(v_before),
      p_after_state := jsonb_build_object(
        'sale', to_jsonb(v_after),
        'from_status', v_before.status,
        'to_status', v_after.status
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_after.id,
      'status', v_after.status,
      'locked_at', v_after.locked_at,
      'already_locked', false,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale:lock' using errcode = '23514';
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
