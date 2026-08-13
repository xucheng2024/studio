-- POS-04 Batch 1: void POS sale transaction RPC (draft/pending_payment only).

create or replace function public.void_pos_sale(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_id uuid,
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
  v_now timestamptz;
  v_reason text;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'request_hash is required' using errcode = '22023';
  end if;

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := p_studio_id,
    p_operation_scope := 'pos_sale:void',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'void_pos_sale idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'void_pos_sale unexpected idempotency outcome: %', v_outcome using errcode = '23514';
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

    if v_sale_before.status = 'voided' then
      v_result := jsonb_build_object(
        'ok', true,
        'sale_id', v_sale_before.id,
        'status', v_sale_before.status,
        'voided_at', v_sale_before.voided_at,
        'payment_id', null,
        'payment_status', null,
        'already_voided', true,
        'already_completed', false
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for pos_sale:void' using errcode = '23514';
      end if;

      return v_result;
    end if;

    if v_sale_before.status <> 'draft' and v_sale_before.status <> 'pending_payment' then
      raise exception 'sale % status % cannot be voided', p_sale_id, v_sale_before.status using errcode = '23514';
    end if;

    if v_sale_before.status = 'pending_payment' then
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

      if v_payment_before.status <> 'pending' and v_payment_before.status <> 'failed' and v_payment_before.status <> 'expired' then
        raise exception 'payment % status % cannot be voided', v_payment_before.id, v_payment_before.status using errcode = '23514';
      end if;
    end if;

    v_now := now();
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');

    if v_payment_before.id is not null and v_payment_before.status = 'pending' then
      update public.payments
      set status = 'failed',
          gateway_status = coalesce(gateway_status, 'voided_by_staff'),
          gateway_payload = coalesce(gateway_payload, jsonb_build_object(
            'source', 'pos_void_sale',
            'voided_at', v_now,
            'voided_by', p_actor_id,
            'reason', v_reason
          )::text)
      where id = v_payment_before.id
      returning * into v_payment_after;
    else
      v_payment_after := v_payment_before;
    end if;

    update public.pos_sales
    set status = 'voided',
        voided_at = coalesce(v_sale_before.voided_at, v_now),
        note = coalesce(v_reason, note),
        updated_by = p_actor_id
    where id = v_sale_before.id
    returning * into v_sale_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_voided',
      p_target_type := 'pos_sale',
      p_actor_type := 'user',
      p_location_id := v_sale_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_sale_before.id,
      p_before_state := jsonb_build_object(
        'sale', to_jsonb(v_sale_before),
        'payment', case when v_payment_before.id is not null then to_jsonb(v_payment_before) else null end
      ),
      p_after_state := jsonb_build_object(
        'sale', to_jsonb(v_sale_after),
        'payment', case when v_payment_after.id is not null then to_jsonb(v_payment_after) else null end,
        'from_status', v_sale_before.status,
        'to_status', v_sale_after.status,
        'void_reason', v_reason,
        'payment_from_status', case when v_payment_before.id is not null then v_payment_before.status else null end,
        'payment_to_status', case when v_payment_after.id is not null then v_payment_after.status else null end
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_after.id,
      'status', v_sale_after.status,
      'voided_at', v_sale_after.voided_at,
      'payment_id', case when v_payment_after.id is not null then v_payment_after.id else null end,
      'payment_status', case when v_payment_after.id is not null then v_payment_after.status else null end,
      'already_voided', false,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale:void' using errcode = '23514';
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

revoke all on function public.void_pos_sale(uuid, text, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.void_pos_sale(uuid, text, uuid, uuid, text, text, text)
  to service_role;
