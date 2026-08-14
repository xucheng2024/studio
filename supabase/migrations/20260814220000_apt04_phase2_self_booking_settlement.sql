-- APT-04 Phase 2: self-booking settlement (package credits / online deposit / online full)
-- Safety goals:
--   * appointment-level settlement fact (single primary record)
--   * server-side computed required_amount/currency only
--   * package consume/return ledger traceability
--   * trusted paid source chain validation (payment -> sale -> settlement -> appointment)
--   * explicit settlement state transitions, terminal cannot jump to paid directly

create table if not exists public.salon_appointment_settlements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  appointment_id uuid not null references public.salon_appointments(id) on delete cascade,
  settlement_mode text not null check (settlement_mode = any (array[
    'free'::text,
    'package_credit'::text,
    'online_deposit'::text,
    'online_full'::text
  ])),
  status text not null check (status = any (array[
    'no_payment_required'::text,
    'package_consumed'::text,
    'pending_payment'::text,
    'deposit_paid'::text,
    'fully_paid'::text,
    'payment_failed'::text,
    'payment_expired'::text,
    'payment_cancelled'::text
  ])),
  required_amount numeric(12,2) not null check (required_amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  payment_id uuid references public.payments(id) on delete set null,
  pos_sale_id uuid references public.pos_sales(id) on delete set null,
  client_package_id uuid references public.client_packages(id) on delete set null,
  consume_ledger_entry_id uuid references public.client_package_ledger_entries(id) on delete set null,
  return_ledger_entry_id uuid references public.client_package_ledger_entries(id) on delete set null,
  is_returned boolean not null default false,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_appointment_settlements_paid_amount_cap
    check (paid_amount <= greatest(required_amount, paid_amount)),
  constraint salon_appointment_settlements_appointment_unique unique (appointment_id)
);

create index if not exists idx_apt_settlements_studio_status_created
  on public.salon_appointment_settlements (studio_id, status, created_at desc);

create index if not exists idx_apt_settlements_payment
  on public.salon_appointment_settlements (payment_id)
  where payment_id is not null;

create index if not exists idx_apt_settlements_sale
  on public.salon_appointment_settlements (pos_sale_id)
  where pos_sale_id is not null;

create index if not exists idx_apt_settlements_customer
  on public.salon_appointment_settlements (studio_id, salon_customer_id, created_at desc);

create or replace function public.apt04_settlement_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_customer record;
  v_location_studio uuid;
  v_payment public.payments;
  v_sale public.pos_sales;
  v_package public.client_packages;
  v_ledger public.client_package_ledger_entries;
begin
  select * into v_appt
  from public.salon_appointments a
  where a.id = new.appointment_id;

  if not found then
    raise exception 'appointment % not found', new.appointment_id using errcode = 'P0002';
  end if;

  if v_appt.studio_id <> new.studio_id then
    raise exception 'settlement studio mismatch with appointment %', new.appointment_id using errcode = '23514';
  end if;

  if v_appt.location_id <> new.location_id then
    raise exception 'settlement location mismatch with appointment %', new.appointment_id using errcode = '23514';
  end if;

  if v_appt.salon_customer_id <> new.salon_customer_id then
    raise exception 'settlement customer mismatch with appointment %', new.appointment_id using errcode = '23514';
  end if;

  select studio_id into v_location_studio
  from public.locations l
  where l.id = new.location_id;

  if v_location_studio is null or v_location_studio <> new.studio_id then
    raise exception 'settlement location % must belong to studio %', new.location_id, new.studio_id using errcode = '23514';
  end if;

  select c.id, c.user_id, c.studio_id
  into v_customer
  from public.salon_customers c
  where c.id = new.salon_customer_id;

  if not found or v_customer.studio_id <> new.studio_id then
    raise exception 'settlement customer % must belong to studio %', new.salon_customer_id, new.studio_id using errcode = '23514';
  end if;

  if new.payment_id is not null then
    select * into v_payment
    from public.payments p
    where p.id = new.payment_id;

    if not found then
      raise exception 'payment % not found', new.payment_id using errcode = 'P0002';
    end if;

    if v_payment.studio_id is distinct from new.studio_id then
      raise exception 'payment % studio mismatch', new.payment_id using errcode = '23514';
    end if;

    if v_payment.pos_sale_id is null then
      raise exception 'payment % must be linked to a pos sale', new.payment_id using errcode = '23514';
    end if;

    if new.pos_sale_id is not null and v_payment.pos_sale_id <> new.pos_sale_id then
      raise exception 'payment % must link to settlement sale %', new.payment_id, new.pos_sale_id using errcode = '23514';
    end if;
  end if;

  if new.pos_sale_id is not null then
    select * into v_sale
    from public.pos_sales s
    where s.id = new.pos_sale_id;

    if not found then
      raise exception 'sale % not found', new.pos_sale_id using errcode = 'P0002';
    end if;

    if v_sale.studio_id <> new.studio_id or v_sale.location_id <> new.location_id then
      raise exception 'sale % must match settlement studio/location', new.pos_sale_id using errcode = '23514';
    end if;

    if v_sale.salon_customer_id is distinct from new.salon_customer_id then
      raise exception 'sale % must match settlement customer', new.pos_sale_id using errcode = '23514';
    end if;
  end if;

  if new.client_package_id is not null then
    select * into v_package
    from public.client_packages cp
    where cp.id = new.client_package_id;

    if not found then
      raise exception 'client package % not found', new.client_package_id using errcode = 'P0002';
    end if;

    if v_package.client_id is distinct from v_customer.user_id then
      raise exception 'client package % owner mismatch', new.client_package_id using errcode = '23514';
    end if;
  end if;

  if new.consume_ledger_entry_id is not null then
    select * into v_ledger
    from public.client_package_ledger_entries le
    where le.id = new.consume_ledger_entry_id;

    if not found then
      raise exception 'consume ledger % not found', new.consume_ledger_entry_id using errcode = 'P0002';
    end if;

    if v_ledger.studio_id <> new.studio_id
       or v_ledger.salon_customer_id <> new.salon_customer_id
       or v_ledger.event_type <> 'consume'
       or v_ledger.source_type <> 'salon_appointment'
       or v_ledger.source_id <> new.appointment_id then
      raise exception 'consume ledger % mismatch settlement linkage', new.consume_ledger_entry_id using errcode = '23514';
    end if;
  end if;

  if new.return_ledger_entry_id is not null then
    select * into v_ledger
    from public.client_package_ledger_entries le
    where le.id = new.return_ledger_entry_id;

    if not found then
      raise exception 'return ledger % not found', new.return_ledger_entry_id using errcode = 'P0002';
    end if;

    if v_ledger.studio_id <> new.studio_id
       or v_ledger.salon_customer_id <> new.salon_customer_id
       or v_ledger.event_type <> 'cancel_return'
       or v_ledger.source_type <> 'salon_appointment_cancel'
       or v_ledger.source_id <> new.appointment_id then
      raise exception 'return ledger % mismatch settlement linkage', new.return_ledger_entry_id using errcode = '23514';
    end if;
  end if;

  if new.settlement_mode = 'free' then
    if new.payment_id is not null or new.pos_sale_id is not null then
      raise exception 'free settlement cannot have payment/sale linkage' using errcode = '23514';
    end if;
  end if;

  if new.settlement_mode = 'package_credit' then
    if new.consume_ledger_entry_id is null or new.client_package_id is null then
      raise exception 'package settlement requires consume ledger and client package' using errcode = '23514';
    end if;
    if new.payment_id is not null or new.pos_sale_id is not null then
      raise exception 'package settlement cannot have online payment linkage' using errcode = '23514';
    end if;
  end if;

  if new.settlement_mode in ('online_deposit', 'online_full') then
    if new.payment_id is null or new.pos_sale_id is null then
      raise exception 'online settlement requires payment + sale linkage' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists apt04_settlement_validate_refs_trg on public.salon_appointment_settlements;
create trigger apt04_settlement_validate_refs_trg
  before insert or update of studio_id, location_id, salon_customer_id, appointment_id, payment_id, pos_sale_id, client_package_id, consume_ledger_entry_id, return_ledger_entry_id, settlement_mode
  on public.salon_appointment_settlements
  for each row execute function public.apt04_settlement_validate_refs();

create or replace function public.apt04_settlement_transition_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending_payment' and new.status in ('deposit_paid', 'fully_paid', 'payment_failed', 'payment_expired', 'payment_cancelled') then
    return new;
  end if;

  raise exception 'invalid settlement status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;

drop trigger if exists apt04_settlement_status_guard_trg on public.salon_appointment_settlements;
create trigger apt04_settlement_status_guard_trg
  before update of status on public.salon_appointment_settlements
  for each row execute function public.apt04_settlement_transition_guard();

-- keep updated_at fresh
create or replace function public.apt04_set_settlement_updated_at()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists apt04_set_settlement_updated_at_trg on public.salon_appointment_settlements;
create trigger apt04_set_settlement_updated_at_trg
  before update on public.salon_appointment_settlements
  for each row execute function public.apt04_set_settlement_updated_at();

create or replace function public.apt04_upsert_appointment_settlement(
  p_actor_id uuid,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_settlement_mode text,
  p_required_amount numeric,
  p_currency text,
  p_payment_id uuid default null,
  p_pos_sale_id uuid default null,
  p_client_package_id uuid default null,
  p_consume_ledger_entry_id uuid default null,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_existing public.salon_appointment_settlements;
  v_status text;
  v_required numeric(12,2);
  v_currency text;
begin
  if p_settlement_mode not in ('free', 'package_credit', 'online_deposit', 'online_full') then
    raise exception 'invalid settlement mode %', p_settlement_mode using errcode = '23514';
  end if;

  select * into v_appt
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  v_required := round(greatest(coalesce(p_required_amount, 0), 0)::numeric, 2);
  v_currency := coalesce(nullif(btrim(coalesce(p_currency, '')), ''), v_appt.service_currency_snapshot, 'SGD');

  if p_settlement_mode = 'free' then
    v_status := 'no_payment_required';
  elsif p_settlement_mode = 'package_credit' then
    v_status := 'package_consumed';
  else
    v_status := 'pending_payment';
  end if;

  select * into v_existing
  from public.salon_appointment_settlements s
  where s.appointment_id = p_appointment_id
  for update;

  if found then
    return jsonb_build_object(
      'ok', true,
      'settlement_id', v_existing.id,
      'status', v_existing.status,
      'already_exists', true
    );
  end if;

  insert into public.salon_appointment_settlements (
    studio_id,
    location_id,
    salon_customer_id,
    appointment_id,
    settlement_mode,
    status,
    required_amount,
    paid_amount,
    currency,
    payment_id,
    pos_sale_id,
    client_package_id,
    consume_ledger_entry_id,
    expires_at,
    metadata,
    created_by,
    updated_by
  ) values (
    p_studio_id,
    v_appt.location_id,
    v_appt.salon_customer_id,
    p_appointment_id,
    p_settlement_mode,
    v_status,
    v_required,
    case when v_status in ('no_payment_required', 'package_consumed') then v_required else 0 end,
    v_currency,
    p_payment_id,
    p_pos_sale_id,
    p_client_package_id,
    p_consume_ledger_entry_id,
    p_expires_at,
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_id,
    p_actor_id
  )
  returning * into v_existing;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_settlement_upserted',
    p_target_type := 'salon_appointment_settlement',
    p_actor_type := 'user',
    p_location_id := v_appt.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := 'customer',
    p_target_id := v_existing.id,
    p_before_state := null,
    p_after_state := to_jsonb(v_existing)
  );

  return jsonb_build_object(
    'ok', true,
    'settlement_id', v_existing.id,
    'status', v_existing.status,
    'already_exists', false
  );
end;
$$;

create or replace function public.pkg01_apply_appointment_package_consume(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_idempotency_key_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appt public.salon_appointments;
  v_customer public.salon_customers;
  v_package public.client_packages;
  v_pkg_def public.packages;
  v_existing public.client_package_ledger_entries;
  v_balance_before integer;
  v_balance_after integer;
  v_ledger_id uuid;
  v_audit_id uuid;
begin
  select * into v_appt
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_appt.status not in ('pending', 'confirmed', 'checked_in', 'in_progress') then
    raise exception 'appointment % status % cannot consume package credits', p_appointment_id, v_appt.status using errcode = '23514';
  end if;

  select * into v_existing
  from public.client_package_ledger_entries le
  where le.studio_id = p_studio_id
    and le.event_type = 'consume'
    and le.source_type = 'salon_appointment'
    and le.source_id = p_appointment_id
  order by le.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_consumed', true,
      'ledger_entry_id', v_existing.id,
      'client_package_id', v_existing.client_package_id
    );
  end if;

  select * into v_customer
  from public.salon_customers c
  where c.id = v_appt.salon_customer_id
    and c.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment customer % not found in studio %', v_appt.salon_customer_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_customer.user_id is null then
    raise exception 'appointment customer % has no linked user', v_customer.id using errcode = '23514';
  end if;

  select cp.*
  into v_package
  from public.client_packages cp
  join public.packages p on p.id = cp.package_id
  where cp.client_id = v_customer.user_id
    and p.studio_id = p_studio_id
    and p.is_active = true
    and (p.location_id is null or p.location_id = v_appt.location_id)
    and (cp.expiry_date is null or cp.expiry_date > now())
    and cp.credits_left >= 1
  order by cp.expiry_date asc nulls last, cp.created_at asc, cp.id asc
  for update of cp
  limit 1;

  if not found then
    raise exception 'no eligible package credits for appointment %', p_appointment_id using errcode = '23514';
  end if;

  select * into v_pkg_def
  from public.packages p
  where p.id = v_package.package_id;

  v_balance_before := v_package.credits_left;
  v_balance_after := v_package.credits_left - 1;

  if v_balance_after < 0 then
    raise exception 'insufficient package credits for appointment %', p_appointment_id using errcode = '23514';
  end if;

  update public.client_packages
  set credits_left = v_balance_after
  where id = v_package.id;

  insert into public.client_package_ledger_entries (
    studio_id,
    location_id,
    client_package_id,
    salon_customer_id,
    package_id,
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
    v_appt.location_id,
    v_package.id,
    v_appt.salon_customer_id,
    v_package.package_id,
    'consume',
    'salon_appointment',
    p_appointment_id,
    -1,
    v_balance_before,
    v_balance_after,
    coalesce(v_appt.service_currency_snapshot, 'SGD'),
    -abs(round(coalesce(v_appt.service_price_snapshot, 0)::numeric, 2)),
    'APT-04 self booking package consume',
    jsonb_build_object(
      'appointmentId', v_appt.id,
      'serviceId', v_appt.service_id,
      'locationId', v_appt.location_id
    ),
    p_idempotency_key_id,
    p_actor_id,
    now()
  )
  returning id into v_ledger_id;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_package_credit_consumed',
    p_target_type := 'salon_appointment',
    p_actor_type := case when coalesce(p_actor_role, '') = 'customer' then 'user' else 'system' end,
    p_location_id := v_appt.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_appt.id,
    p_before_state := jsonb_build_object('client_package_id', v_package.id, 'balance_before', v_balance_before),
    p_after_state := jsonb_build_object('ledger_entry_id', v_ledger_id, 'balance_after', v_balance_after),
    p_correlation_id := p_correlation_id,
    p_idempotency_key_id := p_idempotency_key_id
  );

  update public.client_package_ledger_entries
  set audit_log_id = v_audit_id
  where id = v_ledger_id;

  return jsonb_build_object(
    'ok', true,
    'already_consumed', false,
    'ledger_entry_id', v_ledger_id,
    'client_package_id', v_package.id,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after
  );
end;
$$;

create or replace function public.pkg01_apply_appointment_cancel_return(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settlement public.salon_appointment_settlements;
  v_consume public.client_package_ledger_entries;
  v_package public.client_packages;
  v_appt public.salon_appointments;
  v_existing public.client_package_ledger_entries;
  v_balance_before integer;
  v_balance_after integer;
  v_return_id uuid;
  v_audit_id uuid;
begin
  select * into v_settlement
  from public.salon_appointment_settlements s
  where s.studio_id = p_studio_id
    and s.appointment_id = p_appointment_id
  for update;

  if not found or v_settlement.settlement_mode <> 'package_credit' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_package_settlement');
  end if;

  if v_settlement.is_returned then
    return jsonb_build_object('ok', true, 'already_returned', true, 'return_ledger_entry_id', v_settlement.return_ledger_entry_id);
  end if;

  select * into v_appt
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_appt.status <> 'cancelled' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'appointment_not_cancelled');
  end if;

  select * into v_existing
  from public.client_package_ledger_entries le
  where le.studio_id = p_studio_id
    and le.event_type = 'cancel_return'
    and le.source_type = 'salon_appointment_cancel'
    and le.source_id = p_appointment_id
  order by le.created_at asc
  limit 1;

  if found then
    update public.salon_appointment_settlements
    set is_returned = true,
        return_ledger_entry_id = v_existing.id,
        updated_by = p_actor_id
    where id = v_settlement.id;

    return jsonb_build_object('ok', true, 'already_returned', true, 'return_ledger_entry_id', v_existing.id);
  end if;

  select * into v_consume
  from public.client_package_ledger_entries le
  where le.id = coalesce(v_settlement.consume_ledger_entry_id, '00000000-0000-0000-0000-000000000000'::uuid)
     or (
      le.studio_id = p_studio_id
      and le.event_type = 'consume'
      and le.source_type = 'salon_appointment'
      and le.source_id = p_appointment_id
    )
  order by case when le.id = v_settlement.consume_ledger_entry_id then 0 else 1 end, le.created_at asc
  limit 1;

  if not found then
    raise exception 'missing consume ledger for package settlement appointment %', p_appointment_id using errcode = '23514';
  end if;

  select * into v_package
  from public.client_packages cp
  where cp.id = v_consume.client_package_id
  for update;

  if not found then
    raise exception 'client package % not found for consume ledger', v_consume.client_package_id using errcode = 'P0002';
  end if;

  v_balance_before := v_package.credits_left;
  v_balance_after := v_balance_before + abs(v_consume.delta_credits);

  update public.client_packages
  set credits_left = v_balance_after
  where id = v_package.id;

  insert into public.client_package_ledger_entries (
    studio_id,
    location_id,
    client_package_id,
    salon_customer_id,
    package_id,
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
    created_by,
    occurred_at
  ) values (
    p_studio_id,
    v_appt.location_id,
    v_consume.client_package_id,
    v_consume.salon_customer_id,
    v_consume.package_id,
    'cancel_return',
    'salon_appointment_cancel',
    p_appointment_id,
    abs(v_consume.delta_credits),
    v_balance_before,
    v_balance_after,
    v_consume.currency,
    abs(coalesce(v_consume.value_delta_amount, 0)::numeric),
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'APT-04 appointment cancel return'),
    jsonb_build_object(
      'appointmentId', p_appointment_id,
      'consumeLedgerEntryId', v_consume.id
    ),
    p_actor_id,
    now()
  )
  returning id into v_return_id;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_package_credit_returned_on_cancel',
    p_target_type := 'salon_appointment',
    p_actor_type := case when coalesce(p_actor_role, '') = 'customer' then 'user' else 'system' end,
    p_location_id := v_appt.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_appointment_id,
    p_before_state := jsonb_build_object('client_package_id', v_package.id, 'balance_before', v_balance_before),
    p_after_state := jsonb_build_object('return_ledger_entry_id', v_return_id, 'balance_after', v_balance_after)
  );

  update public.client_package_ledger_entries
  set audit_log_id = v_audit_id
  where id = v_return_id;

  update public.salon_appointment_settlements
  set is_returned = true,
      return_ledger_entry_id = v_return_id,
      updated_by = p_actor_id
  where id = v_settlement.id;

  return jsonb_build_object(
    'ok', true,
    'already_returned', false,
    'return_ledger_entry_id', v_return_id,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after
  );
end;
$$;

create or replace function public.apt04_mark_settlement_paid(
  p_studio_id uuid,
  p_payment_id uuid,
  p_sale_id uuid default null,
  p_actor_role text default 'hitpay_webhook',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_payment public.payments;
  v_sale public.pos_sales;
  v_settlement public.salon_appointment_settlements;
  v_appt public.salon_appointments;
  v_expected_amount numeric(12,2);
  v_target_status text;
begin
  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'payment % not found in studio %', p_payment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_payment.status <> 'paid' then
    raise exception 'payment % is not paid', p_payment_id using errcode = '23514';
  end if;

  if v_payment.source <> 'pos_sale' or v_payment.pos_sale_id is null then
    raise exception 'payment % is not a trusted pos_sale payment source', p_payment_id using errcode = '23514';
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.id = coalesce(p_sale_id, v_payment.pos_sale_id)
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale % not found in studio %', coalesce(p_sale_id, v_payment.pos_sale_id), p_studio_id using errcode = 'P0002';
  end if;

  if v_sale.id <> v_payment.pos_sale_id then
    raise exception 'payment % links to sale %, not %', p_payment_id, v_payment.pos_sale_id, v_sale.id using errcode = '23514';
  end if;

  select * into v_settlement
  from public.salon_appointment_settlements s
  where s.studio_id = p_studio_id
    and s.payment_id = p_payment_id
    and s.pos_sale_id = v_sale.id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'settlement_not_found');
  end if;

  if v_settlement.status in ('payment_failed', 'payment_expired', 'payment_cancelled') then
    raise exception 'terminal settlement % cannot be moved to paid directly', v_settlement.id using errcode = '23514';
  end if;

  if v_settlement.status in ('deposit_paid', 'fully_paid') then
    return jsonb_build_object('ok', true, 'already_paid', true, 'status', v_settlement.status);
  end if;

  select * into v_appt
  from public.salon_appointments a
  where a.id = v_settlement.appointment_id
  for update;

  if not found then
    raise exception 'appointment % missing for settlement %', v_settlement.appointment_id, v_settlement.id using errcode = 'P0002';
  end if;

  if v_appt.studio_id <> p_studio_id
     or v_appt.location_id <> v_settlement.location_id
     or v_appt.salon_customer_id <> v_settlement.salon_customer_id then
    raise exception 'payment->sale->settlement->appointment chain mismatch' using errcode = '23514';
  end if;

  v_expected_amount := round(coalesce((v_settlement.metadata->>'expected_payment_amount')::numeric, v_settlement.required_amount)::numeric, 2);
  if round(coalesce(v_payment.amount, 0)::numeric, 2) <> v_expected_amount then
    raise exception 'payment amount % does not match expected % for settlement %', v_payment.amount, v_expected_amount, v_settlement.id using errcode = '23514';
  end if;

  if v_settlement.settlement_mode = 'online_deposit' then
    v_target_status := 'deposit_paid';
  elsif v_settlement.settlement_mode = 'online_full' then
    v_target_status := 'fully_paid';
  else
    raise exception 'settlement mode % is not online-payable', v_settlement.settlement_mode using errcode = '23514';
  end if;

  update public.salon_appointment_settlements
  set status = v_target_status,
      paid_amount = v_expected_amount,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = v_settlement.id;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_settlement_paid',
    p_target_type := 'salon_appointment_settlement',
    p_actor_type := 'system',
    p_location_id := v_settlement.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_settlement.id,
    p_before_state := to_jsonb(v_settlement),
    p_after_state := jsonb_build_object(
      'status', v_target_status,
      'paid_amount', v_expected_amount,
      'payment_id', p_payment_id,
      'pos_sale_id', v_sale.id
    )
  );

  return jsonb_build_object('ok', true, 'already_paid', false, 'status', v_target_status);
end;
$$;

create or replace function public.apt04_mark_settlement_terminal(
  p_studio_id uuid,
  p_payment_id uuid,
  p_next_status text,
  p_actor_role text default 'hitpay_status_sync',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settlement public.salon_appointment_settlements;
begin
  if p_next_status not in ('payment_failed', 'payment_expired', 'payment_cancelled') then
    raise exception 'invalid terminal settlement status %', p_next_status using errcode = '23514';
  end if;

  select * into v_settlement
  from public.salon_appointment_settlements s
  where s.studio_id = p_studio_id
    and s.payment_id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'settlement_not_found');
  end if;

  if v_settlement.status in ('deposit_paid', 'fully_paid') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_paid');
  end if;

  if v_settlement.status in ('payment_failed', 'payment_expired', 'payment_cancelled') then
    return jsonb_build_object('ok', true, 'already_terminal', true, 'status', v_settlement.status);
  end if;

  update public.salon_appointment_settlements
  set status = p_next_status,
      updated_by = coalesce(p_actor_id, updated_by)
  where id = v_settlement.id;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'apt04_settlement_terminal',
    p_target_type := 'salon_appointment_settlement',
    p_actor_type := 'system',
    p_location_id := v_settlement.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_settlement.id,
    p_before_state := to_jsonb(v_settlement),
    p_after_state := jsonb_build_object('status', p_next_status)
  );

  return jsonb_build_object('ok', true, 'already_terminal', false, 'status', p_next_status);
end;
$$;

create or replace function public.apt04_on_payment_status_sync_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.source, '') <> 'pos_sale' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status = 'paid' then
    perform public.apt04_mark_settlement_paid(
      p_studio_id := new.studio_id,
      p_payment_id := new.id,
      p_sale_id := new.pos_sale_id,
      p_actor_role := 'payment_status_trigger',
      p_actor_id := new.verified_by
    );
    return new;
  end if;

  if new.status = 'failed' then
    perform public.apt04_mark_settlement_terminal(new.studio_id, new.id, 'payment_failed', 'payment_status_trigger', new.verified_by);
    return new;
  end if;

  if new.status = 'expired' then
    perform public.apt04_mark_settlement_terminal(new.studio_id, new.id, 'payment_expired', 'payment_status_trigger', new.verified_by);
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists apt04_on_payment_status_sync_settlement_trg on public.payments;
create trigger apt04_on_payment_status_sync_settlement_trg
  after update of status on public.payments
  for each row execute function public.apt04_on_payment_status_sync_settlement();

create or replace function public.apt04_on_appointment_cancel_return_package()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'cancelled' then
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.status, '') = 'cancelled' then
    return new;
  end if;

  perform public.pkg01_apply_appointment_cancel_return(
    p_studio_id := new.studio_id,
    p_appointment_id := new.id,
    p_actor_id := coalesce(new.updated_by, new.cancellation_actor_id),
    p_actor_role := coalesce(new.cancellation_actor_role, 'system'),
    p_reason := new.cancellation_reason
  );

  return new;
end;
$$;

drop trigger if exists apt04_on_appointment_cancel_return_package_trg on public.salon_appointments;
create trigger apt04_on_appointment_cancel_return_package_trg
  after update of status on public.salon_appointments
  for each row execute function public.apt04_on_appointment_cancel_return_package();

alter table public.salon_appointment_settlements enable row level security;

revoke all on table public.salon_appointment_settlements from public, anon, authenticated;
grant all on table public.salon_appointment_settlements to service_role;

drop policy if exists apt_settlement_self_read on public.salon_appointment_settlements;
create policy apt_settlement_self_read
on public.salon_appointment_settlements
for select
using (
  exists (
    select 1
    from public.salon_customers c
    where c.id = salon_appointment_settlements.salon_customer_id
      and c.user_id = auth.uid()
  )
);

grant select on table public.salon_appointment_settlements to authenticated;

revoke all on function public.apt04_upsert_appointment_settlement(uuid, uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.pkg01_apply_appointment_package_consume(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.pkg01_apply_appointment_cancel_return(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.apt04_mark_settlement_paid(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.apt04_mark_settlement_terminal(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.apt04_upsert_appointment_settlement(uuid, uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;
grant execute on function public.pkg01_apply_appointment_package_consume(uuid, uuid, uuid, text, uuid, text)
  to service_role;
grant execute on function public.pkg01_apply_appointment_cancel_return(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.apt04_mark_settlement_paid(uuid, uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.apt04_mark_settlement_terminal(uuid, uuid, text, text, uuid)
  to service_role;
