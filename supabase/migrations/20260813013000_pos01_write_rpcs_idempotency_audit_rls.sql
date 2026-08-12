-- POS-01 batch 2: write RPC skeletons + FND-04 idempotency/audit + minimal staff read RLS.
-- Scope:
--   * create_pos_sale_draft
--   * upsert_pos_sale_item
--   * lock_pos_sale
--   * Owner/Manager/Frontdesk read policies with location scope

create or replace function public.pos01_assert_actor_scope(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_owner boolean := false;
  v_has_global boolean := false;
  v_has_location boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if p_actor_role not in ('owner', 'manager', 'frontdesk') then
    raise exception 'invalid actor role % for POS-01', p_actor_role using errcode = '42501';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  if not exists (select 1 from public.studios s where s.id = p_studio_id) then
    raise exception 'studio % does not exist', p_studio_id using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.studio_id = p_studio_id
  ) then
    raise exception 'location % does not belong to studio %', p_location_id, p_studio_id using errcode = '23514';
  end if;

  if p_actor_role = 'owner' then
    select exists (
      select 1
      from public.studios s
      where s.id = p_studio_id
        and s.owner_id = p_actor_id
    ) into v_is_owner;

    if not v_is_owner then
      raise exception 'actor % is not owner for studio %', p_actor_id, p_studio_id using errcode = '42501';
    end if;

    return;
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.is_active = true
      and sm.location_id is null
      and sm.role = p_actor_role
  ) into v_has_global;

  if v_has_global then
    return;
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.location_id = p_location_id
      and sm.is_active = true
      and sm.role = p_actor_role
  ) into v_has_location;

  if not v_has_location then
    raise exception 'actor % has no scope for role % at location %', p_actor_id, p_actor_role, p_location_id
      using errcode = '42501';
  end if;
end;
$$;


create or replace function public.create_pos_sale_draft(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_salon_customer_id uuid default null,
  p_note text default null,
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
  v_sale public.pos_sales;
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
    p_operation_scope := 'pos_sale:create_draft',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'create_pos_sale_draft idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'create_pos_sale_draft unexpected idempotency outcome: %', v_outcome using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    perform public.pos01_assert_actor_scope(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_location_id := p_location_id
    );

    insert into public.pos_sales (
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
      note,
      created_by,
      updated_by
    ) values (
      p_studio_id,
      p_location_id,
      p_salon_customer_id,
      p_actor_id,
      'draft',
      'SGD',
      0,
      0,
      0,
      0,
      nullif(btrim(coalesce(p_note, '')), ''),
      p_actor_id,
      p_actor_id
    )
    returning * into v_sale;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_sale_draft_created',
      p_target_type := 'pos_sale',
      p_actor_type := 'user',
      p_location_id := v_sale.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_sale.id,
      p_before_state := null,
      p_after_state := to_jsonb(v_sale),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale.id,
      'status', v_sale.status,
      'location_id', v_sale.location_id,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale:create_draft' using errcode = '23514';
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


create or replace function public.upsert_pos_sale_item(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_id uuid,
  p_item_id uuid default null,
  p_line_number integer default null,
  p_item_type text default null,
  p_service_id uuid default null,
  p_product_id uuid default null,
  p_package_id uuid default null,
  p_salon_appointment_id uuid default null,
  p_employee_id uuid default null,
  p_item_name_snapshot text default null,
  p_item_currency_snapshot text default 'SGD',
  p_quantity numeric default null,
  p_unit_price_amount numeric default null,
  p_discount_amount numeric default 0,
  p_tax_amount numeric default 0,
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
  v_item_after public.pos_sale_items;
  v_is_update boolean := false;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
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
    p_operation_scope := 'pos_sale_item:upsert',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'upsert_pos_sale_item idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'upsert_pos_sale_item unexpected idempotency outcome: %', v_outcome using errcode = '23514';
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

    if p_item_type is null then
      raise exception 'item_type is required' using errcode = '22023';
    end if;

    if p_item_name_snapshot is null or nullif(btrim(p_item_name_snapshot), '') is null then
      raise exception 'item_name_snapshot is required' using errcode = '22023';
    end if;

    if p_quantity is null or p_quantity <= 0 then
      raise exception 'quantity must be > 0' using errcode = '22023';
    end if;

    if p_unit_price_amount is null or p_unit_price_amount < 0 then
      raise exception 'unit_price_amount must be >= 0' using errcode = '22023';
    end if;

    v_subtotal := round((p_quantity * p_unit_price_amount)::numeric, 2);
    v_discount := round(coalesce(p_discount_amount, 0)::numeric, 2);
    v_tax := round(coalesce(p_tax_amount, 0)::numeric, 2);

    if v_discount < 0 then
      raise exception 'discount_amount must be >= 0' using errcode = '22023';
    end if;

    if v_tax < 0 then
      raise exception 'tax_amount must be >= 0' using errcode = '22023';
    end if;

    if v_discount > v_subtotal then
      raise exception 'discount_amount cannot exceed subtotal_amount' using errcode = '22023';
    end if;

    v_total := round((v_subtotal - v_discount + v_tax)::numeric, 2);

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

    if found then
      v_is_update := true;

      update public.pos_sale_items
      set line_number = coalesce(p_line_number, v_item_before.line_number),
          item_type = p_item_type,
          service_id = p_service_id,
          product_id = p_product_id,
          package_id = p_package_id,
          salon_appointment_id = p_salon_appointment_id,
          employee_id = p_employee_id,
          item_name_snapshot = btrim(p_item_name_snapshot),
          item_currency_snapshot = upper(coalesce(nullif(btrim(p_item_currency_snapshot), ''), 'SGD')),
          quantity = p_quantity,
          unit_price_amount = p_unit_price_amount,
          subtotal_amount = v_subtotal,
          discount_amount = v_discount,
          tax_amount = v_tax,
          total_amount = v_total
      where id = v_item_before.id
      returning * into v_item_after;
    else
      insert into public.pos_sale_items (
        sale_id,
        studio_id,
        location_id,
        line_number,
        item_type,
        service_id,
        product_id,
        package_id,
        salon_appointment_id,
        employee_id,
        item_name_snapshot,
        item_currency_snapshot,
        quantity,
        unit_price_amount,
        subtotal_amount,
        discount_amount,
        tax_amount,
        total_amount
      ) values (
        p_sale_id,
        p_studio_id,
        v_sale_before.location_id,
        coalesce(p_line_number, 1),
        p_item_type,
        p_service_id,
        p_product_id,
        p_package_id,
        p_salon_appointment_id,
        p_employee_id,
        btrim(p_item_name_snapshot),
        upper(coalesce(nullif(btrim(p_item_currency_snapshot), ''), 'SGD')),
        p_quantity,
        p_unit_price_amount,
        v_subtotal,
        v_discount,
        v_tax,
        v_total
      )
      returning * into v_item_after;
    end if;

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
      p_action := case when v_is_update then 'pos_sale_item_updated' else 'pos_sale_item_created' end,
      p_target_type := 'pos_sale_item',
      p_actor_type := 'user',
      p_location_id := v_sale_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_item_after.id,
      p_before_state := case when v_is_update then to_jsonb(v_item_before) else null end,
      p_after_state := to_jsonb(v_item_after),
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
        'changed_item_id', v_item_after.id,
        'item_action', case when v_is_update then 'updated' else 'created' end
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_after.id,
      'item_id', v_item_after.id,
      'line_number', v_item_after.line_number,
      'sale_status', v_sale_after.status,
      'sale_total_amount', v_sale_after.total_amount,
      'item_total_amount', v_item_after.total_amount,
      'item_action', case when v_is_update then 'updated' else 'created' end,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_sale_item:upsert' using errcode = '23514';
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


-- ── minimal read surface for staff (Owner/Manager/Frontdesk + location scope) ──
grant select on table public.pos_sales to authenticated;
grant select on table public.pos_sale_items to authenticated;

drop policy if exists pos_sales_staff_read on public.pos_sales;
create policy pos_sales_staff_read
on public.pos_sales
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = pos_sales.studio_id
      and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = auth.uid()
      and sm.studio_id = pos_sales.studio_id
      and sm.is_active = true
      and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])
      and (sm.location_id is null or sm.location_id = pos_sales.location_id)
  )
);

drop policy if exists pos_sale_items_staff_read on public.pos_sale_items;
create policy pos_sale_items_staff_read
on public.pos_sale_items
for select
using (
  exists (
    select 1
    from public.studios s
    where s.id = pos_sale_items.studio_id
      and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = auth.uid()
      and sm.studio_id = pos_sale_items.studio_id
      and sm.is_active = true
      and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])
      and (sm.location_id is null or sm.location_id = pos_sale_items.location_id)
  )
);


revoke all on function public.pos01_assert_actor_scope(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.create_pos_sale_draft(uuid, text, uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.upsert_pos_sale_item(uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text)
  from public, anon, authenticated;
revoke all on function public.lock_pos_sale(uuid, text, uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.pos01_assert_actor_scope(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.create_pos_sale_draft(uuid, text, uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.upsert_pos_sale_item(uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text)
  to service_role;
grant execute on function public.lock_pos_sale(uuid, text, uuid, uuid, text, text)
  to service_role;
