-- COM-01 fixes (P1/P2):
-- 1) appointment employee/service consistency
-- 2) lock-order deadlock prevention (sale -> item)
-- 3) appointment effective_at uses max(paid_at, completed_at)
-- 4) rule version/schedule conflict constraints

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_employee_service_commission_rules_scope_version'
  ) then
    create unique index uq_employee_service_commission_rules_scope_version
      on public.employee_service_commission_rules (
        studio_id,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
        currency,
        rule_version
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_service_commission_rules_no_active_overlap'
      and conrelid = 'public.employee_service_commission_rules'::regclass
  ) then
    alter table public.employee_service_commission_rules
      add constraint employee_service_commission_rules_no_active_overlap
      exclude using gist (
        studio_id with =,
        coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        currency with =,
        tstzrange(effective_from, coalesce(effective_until, 'infinity'::timestamptz), '[)') with &&
      )
      where (is_active);
  end if;
end $$;


create or replace function public.com01_get_appointment_completed_at(
  p_appointment_id uuid
)
returns timestamptz
language sql
security definer
set search_path to 'public'
as $$
  select h.created_at
  from public.salon_appointment_status_history h
  where h.appointment_id = p_appointment_id
    and h.to_status = 'completed'
  order by h.created_at desc
  limit 1;
$$;

revoke all on function public.com01_get_appointment_completed_at(uuid)
  from public, anon, authenticated;
grant execute on function public.com01_get_appointment_completed_at(uuid)
  to service_role;


create or replace function public.service_commission_entries_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item public.pos_sale_items;
  v_sale public.pos_sales;
  v_payment public.payments;
  v_appointment public.salon_appointments;
begin
  select * into v_item
  from public.pos_sale_items i
  where i.id = new.pos_sale_item_id;

  if not found then
    raise exception 'commission pos_sale_item % not found', new.pos_sale_item_id using errcode = 'P0002';
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.id = new.pos_sale_id;

  if not found then
    raise exception 'commission pos_sale % not found', new.pos_sale_id using errcode = 'P0002';
  end if;

  select * into v_payment
  from public.payments p
  where p.id = new.payment_id;

  if not found then
    raise exception 'commission payment % not found', new.payment_id using errcode = 'P0002';
  end if;

  if v_item.studio_id <> new.studio_id
     or v_sale.studio_id <> new.studio_id
     or v_payment.studio_id <> new.studio_id then
    raise exception 'commission entry studio mismatch' using errcode = '23514';
  end if;

  if v_item.sale_id <> new.pos_sale_id or v_item.location_id <> new.location_id then
    raise exception 'commission entry must reference item parent sale/location' using errcode = '23514';
  end if;

  if v_item.item_type <> 'service' then
    raise exception 'commission entry source item % must be service', v_item.id using errcode = '23514';
  end if;

  if v_item.employee_id is distinct from new.employee_id then
    raise exception 'commission entry employee must match sale item employee' using errcode = '23514';
  end if;

  if v_item.service_id is distinct from new.service_id then
    raise exception 'commission entry service must match sale item service' using errcode = '23514';
  end if;

  if v_payment.pos_sale_id is distinct from new.pos_sale_id then
    raise exception 'commission payment must map to the same pos sale' using errcode = '23514';
  end if;

  if new.source_type = 'appointment' then
    if v_item.salon_appointment_id is null or v_item.salon_appointment_id <> new.salon_appointment_id then
      raise exception 'commission appointment source must match sale item appointment' using errcode = '23514';
    end if;

    select * into v_appointment
    from public.salon_appointments a
    where a.id = new.salon_appointment_id;

    if not found or v_appointment.studio_id <> new.studio_id then
      raise exception 'commission appointment source invalid' using errcode = '23514';
    end if;

    if v_appointment.employee_id is distinct from new.employee_id then
      raise exception 'appointment employee mismatch with commission entry' using errcode = '23514';
    end if;

    if v_appointment.service_id is distinct from new.service_id then
      raise exception 'appointment service mismatch with commission entry' using errcode = '23514';
    end if;
  else
    if v_item.salon_appointment_id is not null then
      raise exception 'walkin commission entry cannot reference appointment item' using errcode = '23514';
    end if;

    if v_item.fulfilled_at is null then
      raise exception 'walkin commission entry requires fulfilled_at evidence' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


create or replace function public.com01_try_record_earned_for_sale_item(
  p_sale_item_id uuid,
  p_trigger text default null,
  p_actor_type text default 'system',
  p_actor_id uuid default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item_lookup record;
  v_item public.pos_sale_items;
  v_sale public.pos_sales;
  v_payment public.payments;
  v_appointment public.salon_appointments;
  v_existing_earned public.service_commission_entries;
  v_rule record;
  v_effective_at timestamptz;
  v_amount numeric(12,2);
  v_entry_id uuid;
  v_source_type text;
  v_result jsonb;
begin
  select i.sale_id, i.studio_id
    into v_item_lookup
  from public.pos_sale_items i
  where i.id = p_sale_item_id;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'non_service_item');
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.id = v_item_lookup.sale_id
    and s.studio_id = v_item_lookup.studio_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_not_found');
  end if;

  select * into v_item
  from public.pos_sale_items i
  where i.id = p_sale_item_id
  for update;

  if not found or v_item.item_type <> 'service' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'non_service_item');
  end if;

  if v_item.employee_id is null or v_item.service_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'missing_employee_or_service');
  end if;

  select * into v_payment
  from public.payments p
  where p.studio_id = v_item.studio_id
    and p.pos_sale_id = v_item.sale_id
    and p.source = 'pos_sale'
  for update;

  if not found or v_payment.status <> 'paid' or v_sale.status <> 'paid' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_paid');
  end if;

  if v_item.salon_appointment_id is not null then
    v_source_type := 'appointment';
    select * into v_appointment
    from public.salon_appointments a
    where a.id = v_item.salon_appointment_id
      and a.studio_id = v_item.studio_id;

    if not found or v_appointment.status <> 'completed' then
      return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'appointment_not_completed');
    end if;

    if v_appointment.employee_id is distinct from v_item.employee_id
       or v_appointment.service_id is distinct from v_item.service_id then
      return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'appointment_item_mismatch');
    end if;

    v_effective_at := greatest(
      coalesce(v_payment.paid_at, now()),
      coalesce(v_appointment.updated_at, now())
    );
  else
    v_source_type := 'walkin';
    if v_item.fulfilled_at is null then
      return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'walkin_not_fulfilled');
    end if;

    v_effective_at := greatest(
      coalesce(v_payment.paid_at, now()),
      v_item.fulfilled_at
    );
  end if;

  select * into v_existing_earned
  from public.service_commission_entries e
  where e.studio_id = v_item.studio_id
    and e.pos_sale_item_id = v_item.id
    and e.entry_type = 'earned'
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'entry_id', v_existing_earned.id
    );
  end if;

  select * into v_rule
  from public.com01_resolve_commission_rule(
    p_studio_id := v_item.studio_id,
    p_location_id := v_item.location_id,
    p_employee_id := v_item.employee_id,
    p_service_id := v_item.service_id,
    p_currency := v_item.item_currency_snapshot,
    p_effective_at := v_effective_at
  );

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'rule_not_found');
  end if;

  if v_rule.commission_type = 'fixed_amount' then
    v_amount := round(coalesce(v_rule.fixed_amount, 0) * coalesce(v_item.quantity, 0), 2);
  else
    v_amount := round(coalesce(v_item.total_amount, 0) * coalesce(v_rule.percent_rate, 0) / 100.0, 2);
  end if;

  insert into public.service_commission_entries (
    studio_id, location_id, employee_id, service_id,
    pos_sale_id, pos_sale_item_id, payment_id, salon_appointment_id,
    source_type, entry_type, amount, currency, rule_version,
    rule_snapshot, evidence_snapshot, created_by
  ) values (
    v_item.studio_id,
    v_item.location_id,
    v_item.employee_id,
    v_item.service_id,
    v_item.sale_id,
    v_item.id,
    v_payment.id,
    v_item.salon_appointment_id,
    v_source_type,
    'earned',
    v_amount,
    v_item.item_currency_snapshot,
    v_rule.rule_version,
    jsonb_build_object(
      'ruleId', v_rule.rule_id,
      'ruleVersion', v_rule.rule_version,
      'commissionType', v_rule.commission_type,
      'fixedAmount', v_rule.fixed_amount,
      'percentRate', v_rule.percent_rate,
      'scope', jsonb_build_object(
        'locationId', v_rule.location_id,
        'employeeId', v_rule.employee_id,
        'serviceId', v_rule.service_id
      ),
      'baseAmount', v_item.total_amount,
      'quantity', v_item.quantity
    ),
    jsonb_build_object(
      'trigger', coalesce(p_trigger, 'commission_sync'),
      'saleStatus', v_sale.status,
      'paymentStatus', v_payment.status,
      'paidAt', v_payment.paid_at,
      'appointmentStatus', case when v_source_type = 'appointment' then v_appointment.status else null end,
      'appointmentCompletedAt', case when v_source_type = 'appointment' then v_appointment.updated_at else null end,
      'walkinFulfilledAt', case when v_source_type = 'walkin' then v_item.fulfilled_at else null end
    ),
    p_actor_id
  )
  returning id into v_entry_id;

  perform public.record_strong_audit(
    p_studio_id := v_item.studio_id,
    p_action := 'com01_commission_earned_recorded',
    p_target_type := 'service_commission_entries',
    p_actor_type := p_actor_type,
    p_location_id := v_item.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_entry_id,
    p_after_state := jsonb_build_object(
      'entryId', v_entry_id,
      'posSaleItemId', v_item.id,
      'sourceType', v_source_type,
      'amount', v_amount,
      'ruleVersion', v_rule.rule_version
    )
  );

  v_result := public.com01_apply_refund_reversal_for_sale_item(
    p_sale_item_id := v_item.id,
    p_trigger := coalesce(p_trigger, 'earned_inserted'),
    p_actor_type := p_actor_type,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role
  );

  return jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'entry_type', 'earned',
    'amount', v_amount,
    'refund_sync', v_result
  );
end;
$$;


create or replace function public.com01_mark_pos_service_item_fulfilled(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_sale_item_id uuid,
  p_fulfilled_at timestamptz default null,
  p_fulfillment_note text default null,
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
  v_item_before public.pos_sale_items;
  v_item_after public.pos_sale_items;
  v_sale public.pos_sales;
  v_sale_id uuid;
  v_fulfilled_at timestamptz;
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
    p_operation_scope := 'com01:mark_walkin_fulfilled',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'com01_mark_pos_service_item_fulfilled idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'com01_mark_pos_service_item_fulfilled unexpected idempotency outcome: %', v_outcome
      using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    select i.sale_id
      into v_sale_id
    from public.pos_sale_items i
    where i.id = p_sale_item_id
      and i.studio_id = p_studio_id;

    if v_sale_id is null then
      raise exception 'sale item % not found in studio %', p_sale_item_id, p_studio_id using errcode = 'P0002';
    end if;

    select * into v_sale
    from public.pos_sales s
    where s.id = v_sale_id
      and s.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'sale % not found for item %', v_sale_id, p_sale_item_id using errcode = 'P0002';
    end if;

    perform public.pos01_assert_actor_scope(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_location_id := v_sale.location_id
    );

    select * into v_item_before
    from public.pos_sale_items i
    where i.id = p_sale_item_id
      and i.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'sale item % not found in studio %', p_sale_item_id, p_studio_id using errcode = 'P0002';
    end if;

    if v_item_before.item_type <> 'service' then
      raise exception 'sale item % is not service type', p_sale_item_id using errcode = '23514';
    end if;

    if v_item_before.salon_appointment_id is not null then
      raise exception 'appointment service item cannot be marked as walkin fulfilled' using errcode = '23514';
    end if;

    if v_item_before.fulfilled_at is not null then
      v_result := jsonb_build_object(
        'ok', true,
        'sale_item_id', v_item_before.id,
        'fulfilled_at', v_item_before.fulfilled_at,
        'already_fulfilled', true,
        'already_completed', false
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for com01:mark_walkin_fulfilled' using errcode = '23514';
      end if;

      return v_result;
    end if;

    v_fulfilled_at := coalesce(p_fulfilled_at, now());

    update public.pos_sale_items
    set fulfilled_at = v_fulfilled_at,
        fulfilled_by = p_actor_id,
        fulfillment_note = nullif(btrim(coalesce(p_fulfillment_note, '')), '')
    where id = v_item_before.id
    returning * into v_item_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'com01_walkin_fulfilled',
      p_target_type := 'pos_sale_item',
      p_actor_type := 'user',
      p_location_id := v_item_after.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_item_after.id,
      p_before_state := jsonb_build_object(
        'fulfilledAt', v_item_before.fulfilled_at,
        'fulfilledBy', v_item_before.fulfilled_by
      ),
      p_after_state := jsonb_build_object(
        'fulfilledAt', v_item_after.fulfilled_at,
        'fulfilledBy', v_item_after.fulfilled_by,
        'fulfillmentNote', v_item_after.fulfillment_note
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    perform public.com01_try_record_earned_for_sale_item(
      p_sale_item_id := v_item_after.id,
      p_trigger := 'walkin_fulfilled',
      p_actor_type := 'user',
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_item_id', v_item_after.id,
      'fulfilled_at', v_item_after.fulfilled_at,
      'already_fulfilled', false,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for com01:mark_walkin_fulfilled' using errcode = '23514';
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
