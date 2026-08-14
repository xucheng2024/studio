-- COM-01: Commission rules + earned/reversal entries (append-only).
-- Core principles:
--   * POS service item is the only commission amount source.
--   * Earned only when service completion evidence + POS paid both true.
--   * Exactly one earned entry per POS service item.
--   * Refunds create reversal entries (append-only), never overwrite earned.

alter table public.pos_sale_items
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfilled_by uuid references public.users(id) on delete set null,
  add column if not exists fulfillment_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pos_sale_items_fulfillment_pair_check'
      and conrelid = 'public.pos_sale_items'::regclass
  ) then
    alter table public.pos_sale_items
      add constraint pos_sale_items_fulfillment_pair_check
      check (
        (fulfilled_at is null and fulfilled_by is null)
        or (fulfilled_at is not null and fulfilled_by is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pos_sale_items_non_service_no_fulfillment_check'
      and conrelid = 'public.pos_sale_items'::regclass
  ) then
    alter table public.pos_sale_items
      add constraint pos_sale_items_non_service_no_fulfillment_check
      check (
        item_type = 'service'
        or (fulfilled_at is null and fulfilled_by is null and fulfillment_note is null)
      );
  end if;
end $$;

create index if not exists idx_pos_sale_items_service_fulfillment
  on public.pos_sale_items (studio_id, location_id, fulfilled_at desc)
  where item_type = 'service';


create table if not exists public.employee_service_commission_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  employee_id uuid references public.employees(id) on delete cascade,
  service_id uuid references public.studio_services(id) on delete cascade,
  commission_type text not null
    check (commission_type = any (array['fixed_amount'::text, 'percent'::text])),
  fixed_amount numeric(12,2),
  percent_rate numeric(7,4),
  currency text not null default 'SGD'
    check (currency ~ '^[A-Z]{3}$'::text),
  rule_version integer not null check (rule_version > 0),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_service_commission_rules_amount_check check (
    (
      commission_type = 'fixed_amount'
      and fixed_amount is not null
      and fixed_amount >= 0
      and percent_rate is null
    )
    or (
      commission_type = 'percent'
      and percent_rate is not null
      and percent_rate >= 0
      and percent_rate <= 100
      and fixed_amount is null
    )
  ),
  constraint employee_service_commission_rules_effective_window_check check (
    effective_until is null or effective_until > effective_from
  )
);

create index if not exists idx_employee_service_commission_rules_studio_effective
  on public.employee_service_commission_rules (studio_id, is_active, effective_from desc, effective_until);

create index if not exists idx_employee_service_commission_rules_lookup
  on public.employee_service_commission_rules (studio_id, location_id, employee_id, service_id, rule_version desc);

drop trigger if exists set_employee_service_commission_rules_updated_at on public.employee_service_commission_rules;
create trigger set_employee_service_commission_rules_updated_at
  before update on public.employee_service_commission_rules
  for each row execute function public.set_updated_at_timestamp();

create or replace function public.employee_service_commission_rules_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_employee_studio uuid;
  v_service_studio uuid;
begin
  if new.location_id is not null then
    select studio_id into v_location_studio
    from public.locations
    where id = new.location_id;

    if v_location_studio is null or v_location_studio <> new.studio_id then
      raise exception 'commission rule location % does not belong to studio %', new.location_id, new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.employee_id is not null then
    select studio_id into v_employee_studio
    from public.employees
    where id = new.employee_id;

    if v_employee_studio is null or v_employee_studio <> new.studio_id then
      raise exception 'commission rule employee % does not belong to studio %', new.employee_id, new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.service_id is not null then
    select studio_id into v_service_studio
    from public.studio_services
    where id = new.service_id;

    if v_service_studio is null or v_service_studio <> new.studio_id then
      raise exception 'commission rule service % does not belong to studio %', new.service_id, new.studio_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists employee_service_commission_rules_validate_refs_trg on public.employee_service_commission_rules;
create trigger employee_service_commission_rules_validate_refs_trg
  before insert or update of studio_id, location_id, employee_id, service_id
  on public.employee_service_commission_rules
  for each row execute function public.employee_service_commission_rules_validate_refs();


create table if not exists public.service_commission_entries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  service_id uuid not null references public.studio_services(id) on delete restrict,
  pos_sale_id uuid not null references public.pos_sales(id) on delete restrict,
  pos_sale_item_id uuid not null references public.pos_sale_items(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  salon_appointment_id uuid references public.salon_appointments(id) on delete restrict,
  source_type text not null
    check (source_type = any (array['appointment'::text, 'walkin'::text])),
  entry_type text not null
    check (entry_type = any (array['earned'::text, 'refund_reversal'::text])),
  amount numeric(12,2) not null,
  currency text not null
    check (currency ~ '^[A-Z]{3}$'::text),
  rule_version integer not null check (rule_version > 0),
  rule_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  origin_entry_id uuid references public.service_commission_entries(id) on delete restrict,
  refund_checkpoint_key text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_commission_entries_source_ref_check check (
    (source_type = 'appointment' and salon_appointment_id is not null)
    or (source_type = 'walkin' and salon_appointment_id is null)
  ),
  constraint service_commission_entries_origin_check check (
    (entry_type = 'earned' and origin_entry_id is null)
    or (entry_type = 'refund_reversal' and origin_entry_id is not null)
  ),
  constraint service_commission_entries_amount_direction_check check (
    (entry_type = 'earned' and amount >= 0)
    or (entry_type = 'refund_reversal' and amount < 0)
  )
);

create unique index if not exists uq_service_commission_entries_earned_source
  on public.service_commission_entries (studio_id, pos_sale_item_id)
  where entry_type = 'earned';

create unique index if not exists uq_service_commission_entries_refund_checkpoint
  on public.service_commission_entries (studio_id, refund_checkpoint_key)
  where entry_type = 'refund_reversal' and refund_checkpoint_key is not null;

create index if not exists idx_service_commission_entries_studio_created
  on public.service_commission_entries (studio_id, created_at desc);

create index if not exists idx_service_commission_entries_employee_created
  on public.service_commission_entries (studio_id, employee_id, created_at desc);

create index if not exists idx_service_commission_entries_service_created
  on public.service_commission_entries (studio_id, service_id, created_at desc);

create index if not exists idx_service_commission_entries_origin
  on public.service_commission_entries (origin_entry_id)
  where origin_entry_id is not null;

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

drop trigger if exists service_commission_entries_validate_refs_trg on public.service_commission_entries;
create trigger service_commission_entries_validate_refs_trg
  before insert on public.service_commission_entries
  for each row execute function public.service_commission_entries_validate_refs();

create or replace function public.prevent_service_commission_entries_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'service_commission_entries is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists service_commission_entries_append_only_upd on public.service_commission_entries;
create trigger service_commission_entries_append_only_upd
  before update on public.service_commission_entries
  for each row execute function public.prevent_service_commission_entries_mutation();

drop trigger if exists service_commission_entries_append_only_del on public.service_commission_entries;
create trigger service_commission_entries_append_only_del
  before delete on public.service_commission_entries
  for each row execute function public.prevent_service_commission_entries_mutation();


create or replace function public.com01_resolve_commission_rule(
  p_studio_id uuid,
  p_location_id uuid,
  p_employee_id uuid,
  p_service_id uuid,
  p_currency text,
  p_effective_at timestamptz
)
returns table(
  rule_id uuid,
  rule_version integer,
  commission_type text,
  fixed_amount numeric,
  percent_rate numeric,
  currency text,
  location_id uuid,
  employee_id uuid,
  service_id uuid
)
language sql
security definer
set search_path to 'public'
as $$
  with candidates as (
    select
      r.id as rule_id,
      r.rule_version,
      r.commission_type,
      r.fixed_amount,
      r.percent_rate,
      r.currency,
      r.location_id,
      r.employee_id,
      r.service_id,
      (
        case when r.location_id is not null then 1 else 0 end
        + case when r.employee_id is not null then 1 else 0 end
        + case when r.service_id is not null then 1 else 0 end
      ) as specificity
    from public.employee_service_commission_rules r
    where r.studio_id = p_studio_id
      and r.is_active = true
      and (r.location_id is null or r.location_id = p_location_id)
      and (r.employee_id is null or r.employee_id = p_employee_id)
      and (r.service_id is null or r.service_id = p_service_id)
      and r.currency = p_currency
      and r.effective_from <= p_effective_at
      and (r.effective_until is null or r.effective_until > p_effective_at)
  )
  select
    c.rule_id,
    c.rule_version,
    c.commission_type,
    c.fixed_amount,
    c.percent_rate,
    c.currency,
    c.location_id,
    c.employee_id,
    c.service_id
  from candidates c
  order by c.specificity desc, c.rule_version desc, c.rule_id
  limit 1;
$$;


create or replace function public.com01_apply_refund_reversal_for_sale_item(
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
  v_item public.pos_sale_items;
  v_sale public.pos_sales;
  v_payment public.payments;
  v_earned public.service_commission_entries;
  v_origin_reversed_abs numeric(12,2);
  v_target_reversed_abs numeric(12,2);
  v_delta_abs numeric(12,2);
  v_checkpoint_key text;
  v_reversal_id uuid;
begin
  select * into v_item
  from public.pos_sale_items i
  where i.id = p_sale_item_id
  for update;

  if not found or v_item.item_type <> 'service' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'non_service_item');
  end if;

  select * into v_earned
  from public.service_commission_entries e
  where e.studio_id = v_item.studio_id
    and e.pos_sale_item_id = v_item.id
    and e.entry_type = 'earned'
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'earned_not_found');
  end if;

  if coalesce(v_item.refunded_amount, 0) <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_refunded');
  end if;

  if coalesce(v_item.total_amount, 0) <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'non_positive_total_amount');
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.id = v_item.sale_id;

  select * into v_payment
  from public.payments p
  where p.studio_id = v_item.studio_id
    and p.pos_sale_id = v_item.sale_id
  limit 1;

  select round(coalesce(sum(abs(e.amount)), 0)::numeric, 2)
    into v_origin_reversed_abs
  from public.service_commission_entries e
  where e.origin_entry_id = v_earned.id
    and e.entry_type = 'refund_reversal';

  v_target_reversed_abs := round(
    abs(v_earned.amount)
    * least(coalesce(v_item.refunded_amount, 0), v_item.total_amount)
    / nullif(v_item.total_amount, 0),
    2
  );

  v_delta_abs := round(v_target_reversed_abs - coalesce(v_origin_reversed_abs, 0), 2);
  if v_delta_abs <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_reversal_delta');
  end if;

  v_checkpoint_key := md5(
    format('%s|%s|%s', v_item.id, coalesce(v_item.refunded_quantity, 0), coalesce(v_item.refunded_amount, 0))
  );

  if exists (
    select 1
    from public.service_commission_entries e
    where e.studio_id = v_item.studio_id
      and e.entry_type = 'refund_reversal'
      and e.refund_checkpoint_key = v_checkpoint_key
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'checkpoint_already_recorded');
  end if;

  insert into public.service_commission_entries (
    studio_id,
    location_id,
    employee_id,
    service_id,
    pos_sale_id,
    pos_sale_item_id,
    payment_id,
    salon_appointment_id,
    source_type,
    entry_type,
    amount,
    currency,
    rule_version,
    rule_snapshot,
    evidence_snapshot,
    origin_entry_id,
    refund_checkpoint_key,
    created_by
  ) values (
    v_earned.studio_id,
    v_earned.location_id,
    v_earned.employee_id,
    v_earned.service_id,
    v_earned.pos_sale_id,
    v_earned.pos_sale_item_id,
    v_earned.payment_id,
    v_earned.salon_appointment_id,
    v_earned.source_type,
    'refund_reversal',
    -v_delta_abs,
    v_earned.currency,
    v_earned.rule_version,
    v_earned.rule_snapshot,
    jsonb_build_object(
      'trigger', coalesce(p_trigger, 'refund_sync'),
      'refundedAmount', v_item.refunded_amount,
      'refundedQuantity', v_item.refunded_quantity,
      'saleStatus', v_sale.status,
      'paymentStatus', v_payment.status
    ),
    v_earned.id,
    v_checkpoint_key,
    p_actor_id
  )
  returning id into v_reversal_id;

  perform public.record_strong_audit(
    p_studio_id := v_item.studio_id,
    p_action := 'com01_commission_refund_reversal_recorded',
    p_target_type := 'service_commission_entries',
    p_actor_type := p_actor_type,
    p_location_id := v_item.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_reversal_id,
    p_before_state := jsonb_build_object(
      'originEntryId', v_earned.id,
      'alreadyReversedAbs', v_origin_reversed_abs
    ),
    p_after_state := jsonb_build_object(
      'reversalEntryId', v_reversal_id,
      'deltaAbs', v_delta_abs,
      'targetReversedAbs', v_target_reversed_abs,
      'checkpointKey', v_checkpoint_key
    )
  );

  return jsonb_build_object(
    'ok', true,
    'entry_id', v_reversal_id,
    'entry_type', 'refund_reversal',
    'amount', -v_delta_abs
  );
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

  select * into v_sale
  from public.pos_sales s
  where s.id = v_item.sale_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_not_found');
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

    v_effective_at := coalesce(v_payment.paid_at, v_sale.paid_at, now());
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
    studio_id,
    location_id,
    employee_id,
    service_id,
    pos_sale_id,
    pos_sale_item_id,
    payment_id,
    salon_appointment_id,
    source_type,
    entry_type,
    amount,
    currency,
    rule_version,
    rule_snapshot,
    evidence_snapshot,
    created_by
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


create or replace function public.com01_sync_sale_commissions_from_sale(
  p_sale_id uuid,
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
  v_item record;
  v_count integer := 0;
begin
  for v_item in
    select i.id
    from public.pos_sale_items i
    where i.sale_id = p_sale_id
      and i.item_type = 'service'
  loop
    perform public.com01_try_record_earned_for_sale_item(
      p_sale_item_id := v_item.id,
      p_trigger := p_trigger,
      p_actor_type := p_actor_type,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role
    );

    perform public.com01_apply_refund_reversal_for_sale_item(
      p_sale_item_id := v_item.id,
      p_trigger := p_trigger,
      p_actor_type := p_actor_type,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'processed_items', v_count);
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

    select * into v_sale
    from public.pos_sales s
    where s.id = v_item_before.sale_id
      and s.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'sale % not found for item %', v_item_before.sale_id, p_sale_item_id using errcode = 'P0002';
    end if;

    perform public.pos01_assert_actor_scope(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_location_id := v_sale.location_id
    );

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


create or replace function public.com01_on_pos_sale_paid_sync_commissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'paid' and old.status is distinct from new.status then
    perform public.com01_sync_sale_commissions_from_sale(
      p_sale_id := new.id,
      p_trigger := 'sale_paid',
      p_actor_type := 'system',
      p_actor_id := new.updated_by,
      p_actor_role := 'system'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists com01_on_pos_sale_paid_sync_commissions_trg on public.pos_sales;
create trigger com01_on_pos_sale_paid_sync_commissions_trg
  after update of status on public.pos_sales
  for each row execute function public.com01_on_pos_sale_paid_sync_commissions();


create or replace function public.com01_on_appointment_completed_sync_commissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item record;
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    for v_item in
      select i.id
      from public.pos_sale_items i
      where i.salon_appointment_id = new.id
        and i.item_type = 'service'
    loop
      perform public.com01_try_record_earned_for_sale_item(
        p_sale_item_id := v_item.id,
        p_trigger := 'appointment_completed',
        p_actor_type := 'system',
        p_actor_id := new.updated_by,
        p_actor_role := 'system'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists com01_on_appointment_completed_sync_commissions_trg on public.salon_appointments;
create trigger com01_on_appointment_completed_sync_commissions_trg
  after update of status on public.salon_appointments
  for each row execute function public.com01_on_appointment_completed_sync_commissions();


create or replace function public.com01_on_walkin_fulfilled_sync_commissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.item_type = 'service'
     and new.salon_appointment_id is null
     and new.fulfilled_at is not null
     and old.fulfilled_at is distinct from new.fulfilled_at then
    perform public.com01_try_record_earned_for_sale_item(
      p_sale_item_id := new.id,
      p_trigger := 'walkin_fulfilled_update',
      p_actor_type := 'system',
      p_actor_id := new.fulfilled_by,
      p_actor_role := 'system'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists com01_on_walkin_fulfilled_sync_commissions_trg on public.pos_sale_items;
create trigger com01_on_walkin_fulfilled_sync_commissions_trg
  after update of fulfilled_at on public.pos_sale_items
  for each row execute function public.com01_on_walkin_fulfilled_sync_commissions();


create or replace function public.com01_on_pos_sale_item_refund_sync_commissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.item_type = 'service'
     and (
       old.refunded_amount is distinct from new.refunded_amount
       or old.refunded_quantity is distinct from new.refunded_quantity
     ) then
    perform public.com01_apply_refund_reversal_for_sale_item(
      p_sale_item_id := new.id,
      p_trigger := 'sale_item_refund',
      p_actor_type := 'system',
      p_actor_id := null,
      p_actor_role := 'system'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists com01_on_pos_sale_item_refund_sync_commissions_trg on public.pos_sale_items;
create trigger com01_on_pos_sale_item_refund_sync_commissions_trg
  after update of refunded_amount, refunded_quantity on public.pos_sale_items
  for each row execute function public.com01_on_pos_sale_item_refund_sync_commissions();


alter table public.employee_service_commission_rules enable row level security;
alter table public.service_commission_entries enable row level security;

revoke all on table public.employee_service_commission_rules from public;
revoke all on table public.employee_service_commission_rules from anon;
revoke all on table public.employee_service_commission_rules from authenticated;
grant all on table public.employee_service_commission_rules to service_role;

revoke all on table public.service_commission_entries from public;
revoke all on table public.service_commission_entries from anon;
revoke all on table public.service_commission_entries from authenticated;
grant all on table public.service_commission_entries to service_role;


revoke all on function public.com01_resolve_commission_rule(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.com01_resolve_commission_rule(uuid, uuid, uuid, uuid, text, timestamptz)
  to service_role;

revoke all on function public.com01_apply_refund_reversal_for_sale_item(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.com01_apply_refund_reversal_for_sale_item(uuid, text, text, uuid, text)
  to service_role;

revoke all on function public.com01_try_record_earned_for_sale_item(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.com01_try_record_earned_for_sale_item(uuid, text, text, uuid, text)
  to service_role;

revoke all on function public.com01_sync_sale_commissions_from_sale(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.com01_sync_sale_commissions_from_sale(uuid, text, text, uuid, text)
  to service_role;

revoke all on function public.com01_mark_pos_service_item_fulfilled(uuid, text, uuid, uuid, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.com01_mark_pos_service_item_fulfilled(uuid, text, uuid, uuid, timestamptz, text, text, text)
  to service_role;

