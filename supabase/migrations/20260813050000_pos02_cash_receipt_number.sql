-- POS-02 Batch 2: assign receipt number when cash sale is completed.

create sequence if not exists public.pos_receipt_global_seq;

create or replace function public.pos_generate_receipt_number(
  p_paid_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_seq bigint;
  v_sgt_day text;
begin
  v_seq := nextval('public.pos_receipt_global_seq');
  v_sgt_day := to_char(timezone('Asia/Singapore', coalesce(p_paid_at, now())), 'YYYYMMDD');
  return format('R%s-%s', v_sgt_day, lpad(v_seq::text, 8, '0'));
end;
$$;

create or replace function public.complete_pos_cash_sale(
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
  v_sale_before public.pos_sales;
  v_sale_after public.pos_sales;
  v_payment_before public.payments;
  v_payment_after public.payments;
  v_now timestamptz;
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
    p_operation_scope := 'pos_sale:complete_cash',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'complete_pos_cash_sale idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'complete_pos_cash_sale unexpected idempotency outcome: %', v_outcome using errcode = '23514';
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

    if v_sale_before.status <> 'pending_payment' and v_sale_before.status <> 'paid' then
      raise exception 'sale % status % cannot complete cash sale', p_sale_id, v_sale_before.status using errcode = '23514';
    end if;

    select *
    into v_payment_before
    from public.payments p
    where p.studio_id = p_studio_id
      and p.pos_sale_id = v_sale_before.id
    for update;

    if not found then
      raise exception 'payment for sale % not found', p_sale_id using errcode = '23514';
    end if;

    if v_payment_before.status <> 'pending' and v_payment_before.status <> 'paid' then
      raise exception 'payment % status % not ready for cash completion', v_payment_before.id, v_payment_before.status
        using errcode = '23514';
    end if;

    if v_sale_before.status = 'paid' and v_payment_before.status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'sale_id', v_sale_before.id,
        'payment_id', v_payment_before.id,
        'sale_status', v_sale_before.status,
        'payment_status', v_payment_before.status,
        'paid_at', v_sale_before.paid_at,
        'verified_at', v_payment_before.verified_at,
        'verified_by', v_payment_before.verified_by,
        'payment_method', v_payment_before.payment_method,
        'receipt_number', v_sale_before.receipt_number,
        'already_paid', true,
        'already_completed', false
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for pos_sale:complete_cash' using errcode = '23514';
      end if;

      return v_result;
    end if;

    v_now := now();

    update public.payments
    set status = 'paid',
        payment_method = 'cash',
        paid_at = coalesce(v_payment_before.paid_at, v_now),
        verified_at = coalesce(v_payment_before.verified_at, v_now),
        verified_by = coalesce(v_payment_before.verified_by, p_actor_id)
    where id = v_payment_before.id
    returning * into v_payment_after;

    update public.pos_sales
    set status = 'paid',
        paid_at = coalesce(v_sale_before.paid_at, v_now),
        receipt_number = coalesce(v_sale_before.receipt_number, public.pos_generate_receipt_number(v_now)),
        updated_by = p_actor_id
    where id = v_sale_before.id
    returning * into v_sale_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_cash_sale_completed',
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
        'from_status', v_sale_before.status,
        'to_status', v_sale_after.status,
        'payment_from_status', v_payment_before.status,
        'payment_to_status', v_payment_after.status,
        'payment_method', v_payment_after.payment_method,
        'receipt_number', v_sale_after.receipt_number
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_after.id,
      'payment_id', v_payment_after.id,
      'sale_status', v_sale_after.status,
      'payment_status', v_payment_after.status,
      'paid_at', v_sale_after.paid_at,
      'verified_at', v_payment_after.verified_at,
      'verified_by', v_payment_after.verified_by,
      'payment_method', v_payment_after.payment_method,
      'receipt_number', v_sale_after.receipt_number,
      'already_paid', false,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale:complete_cash' using errcode = '23514';
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

revoke all on function public.pos_generate_receipt_number(timestamptz)
  from public, anon, authenticated;

grant execute on function public.pos_generate_receipt_number(timestamptz)
  to service_role;
