-- POS-02: delete_pos_sale_item RPC.
-- Lets staff remove a mis-added draft-sale line item outright, mirroring the
-- idempotency/audit/RLS conventions established in pos01_write_rpcs_idempotency_audit_rls.sql
-- for upsert_pos_sale_item. Only allowed while the sale is still an editable draft.

create or replace function public.delete_pos_sale_item(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_id uuid,
  p_item_id uuid default null,
  p_line_number integer default null,
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
  v_item_before public.pos_sale_items;
  v_sale_subtotal numeric(12,2);
  v_sale_discount numeric(12,2);
  v_sale_tax numeric(12,2);
  v_sale_total numeric(12,2);
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
    p_operation_scope := 'pos_sale_item:delete',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'delete_pos_sale_item idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'delete_pos_sale_item unexpected idempotency outcome: %', v_outcome using errcode = '23514';
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

    if v_sale_before.status <> 'draft' or v_sale_before.locked_at is not null then
      raise exception 'sale % is locked and cannot be edited', p_sale_id using errcode = '23514';
    end if;

    if p_item_id is null and p_line_number is null then
      raise exception 'either item_id or line_number is required' using errcode = '22023';
    end if;

    if p_item_id is not null then
      select *
      into v_item_before
      from public.pos_sale_items i
      where i.id = p_item_id
        and i.sale_id = p_sale_id
      for update;
    else
      select *
      into v_item_before
      from public.pos_sale_items i
      where i.sale_id = p_sale_id
        and i.line_number = p_line_number
      for update;
    end if;

    if not found then
      raise exception 'sale item not found for sale %', p_sale_id using errcode = 'P0002';
    end if;

    delete from public.pos_sale_items where id = v_item_before.id;

    select
      coalesce(sum(i.subtotal_amount), 0),
      coalesce(sum(i.discount_amount), 0),
      coalesce(sum(i.tax_amount), 0),
      coalesce(sum(i.total_amount), 0)
    into
      v_sale_subtotal,
      v_sale_discount,
      v_sale_tax,
      v_sale_total
    from public.pos_sale_items i
    where i.sale_id = p_sale_id;

    update public.pos_sales
    set subtotal_amount = v_sale_subtotal,
        discount_amount = v_sale_discount,
        tax_amount = v_sale_tax,
        total_amount = v_sale_total,
        updated_by = p_actor_id
    where id = p_sale_id
    returning * into v_sale_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_item_deleted',
      p_target_type := 'pos_sale_item',
      p_actor_type := 'user',
      p_location_id := v_sale_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_item_before.id,
      p_before_state := to_jsonb(v_item_before),
      p_after_state := null,
      p_idempotency_key_id := v_idempotency_key_id
    );

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_totals_recomputed',
      p_target_type := 'pos_sale',
      p_actor_type := 'user',
      p_location_id := v_sale_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_sale_after.id,
      p_before_state := to_jsonb(v_sale_before),
      p_after_state := jsonb_build_object(
        'sale', to_jsonb(v_sale_after),
        'deleted_item_id', v_item_before.id,
        'item_action', 'deleted'
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_after.id,
      'deleted_item_id', v_item_before.id,
      'line_number', v_item_before.line_number,
      'sale_status', v_sale_after.status,
      'sale_total_amount', v_sale_after.total_amount,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale_item:delete' using errcode = '23514';
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

revoke all on function public.delete_pos_sale_item(uuid, text, uuid, uuid, uuid, integer, text, text)
  from public, anon, authenticated;

grant execute on function public.delete_pos_sale_item(uuid, text, uuid, uuid, uuid, integer, text, text)
  to service_role;
