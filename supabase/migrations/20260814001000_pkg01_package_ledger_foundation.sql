-- PKG-01 batch 1: package ledger foundation.
-- Scope:
--   * append-only client_package_ledger_entries table
--   * source/event dedup constraints + read indexes
--   * cross-table studio/location/customer/package consistency guards
--   * audit/idempotency reference fields

create table if not exists public.client_package_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete restrict,
  client_package_id uuid not null references public.client_packages(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  package_id uuid not null references public.packages(id) on delete restrict,
  pos_sale_id uuid references public.pos_sales(id) on delete set null,
  pos_sale_item_id uuid references public.pos_sale_items(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  event_type text not null
    check (event_type = any (array[
      'opening_balance'::text,
      'purchase_grant'::text,
      'consume'::text,
      'cancel_return'::text,
      'refund_reversal'::text,
      'expiry'::text,
      'manual_adjustment'::text
    ])),
  source_type text not null,
  source_id uuid,
  delta_credits integer not null check (delta_credits <> 0),
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  currency text not null default 'SGD'
    check (currency ~ '^[A-Z]{3}$'::text),
  value_delta_amount numeric(12,2),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  audit_log_id uuid references public.strong_audit_logs(id) on delete restrict,
  idempotency_key_id uuid references public.business_idempotency_keys(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint client_package_ledger_balance_math_check
    check (balance_after = balance_before + delta_credits),
  constraint client_package_ledger_value_delta_sign_check
    check (
      value_delta_amount is null
      or (
        (delta_credits > 0 and value_delta_amount >= 0)
        or (delta_credits < 0 and value_delta_amount <= 0)
      )
    )
);

create unique index if not exists uq_client_package_ledger_source_event
  on public.client_package_ledger_entries (studio_id, source_type, source_id, event_type, client_package_id)
  where source_id is not null;

create index if not exists idx_client_package_ledger_customer_package_created
  on public.client_package_ledger_entries (studio_id, salon_customer_id, package_id, created_at desc);

create index if not exists idx_client_package_ledger_client_package_created
  on public.client_package_ledger_entries (client_package_id, created_at desc);

create index if not exists idx_client_package_ledger_studio_location_created
  on public.client_package_ledger_entries (studio_id, location_id, created_at desc)
  where location_id is not null;

create index if not exists idx_client_package_ledger_event_created
  on public.client_package_ledger_entries (event_type, created_at desc);

create index if not exists idx_client_package_ledger_pos_sale_item
  on public.client_package_ledger_entries (pos_sale_item_id)
  where pos_sale_item_id is not null;

create index if not exists idx_client_package_ledger_payment
  on public.client_package_ledger_entries (payment_id)
  where payment_id is not null;

create index if not exists idx_client_package_ledger_audit_log
  on public.client_package_ledger_entries (audit_log_id)
  where audit_log_id is not null;

create index if not exists idx_client_package_ledger_idempotency_key
  on public.client_package_ledger_entries (idempotency_key_id)
  where idempotency_key_id is not null;

create or replace function public.client_package_ledger_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_customer_studio uuid;
  v_customer_user_id uuid;
  v_package_studio uuid;
  v_client_package_package_id uuid;
  v_client_package_client_id uuid;
  v_pos_sale public.pos_sales;
  v_pos_sale_item public.pos_sale_items;
  v_payment public.payments;
  v_audit_studio uuid;
  v_idempotency_studio uuid;
begin
  if new.location_id is not null then
    select studio_id
    into v_location_studio
    from public.locations
    where id = new.location_id;

    if v_location_studio is null then
      raise exception 'location % not found', new.location_id using errcode = 'P0002';
    end if;
    if v_location_studio <> new.studio_id then
      raise exception 'ledger location must belong to studio %', new.studio_id using errcode = '23514';
    end if;
  end if;

  select studio_id, user_id
  into v_customer_studio, v_customer_user_id
  from public.salon_customers
  where id = new.salon_customer_id;

  if v_customer_studio is null then
    raise exception 'salon customer % not found', new.salon_customer_id using errcode = 'P0002';
  end if;
  if v_customer_studio <> new.studio_id then
    raise exception 'ledger customer must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  select cp.client_id, pkg.id, pkg.studio_id
  into v_client_package_client_id, v_client_package_package_id, v_package_studio
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.id = new.client_package_id;

  if v_client_package_package_id is null then
    raise exception 'client package % not found', new.client_package_id using errcode = 'P0002';
  end if;

  if v_package_studio <> new.studio_id then
    raise exception 'client package must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  if v_client_package_package_id <> new.package_id then
    raise exception 'ledger package_id must match client package source package_id' using errcode = '23514';
  end if;

  if v_customer_user_id is null or v_client_package_client_id <> v_customer_user_id then
    raise exception 'ledger salon_customer must match client_packages.client_id identity' using errcode = '23514';
  end if;

  if new.pos_sale_id is not null then
    select * into v_pos_sale
    from public.pos_sales s
    where s.id = new.pos_sale_id;

    if not found then
      raise exception 'pos sale % not found', new.pos_sale_id using errcode = 'P0002';
    end if;

    if v_pos_sale.studio_id <> new.studio_id then
      raise exception 'pos sale must belong to studio %', new.studio_id using errcode = '23514';
    end if;

    if v_pos_sale.salon_customer_id is not null
       and v_pos_sale.salon_customer_id <> new.salon_customer_id then
      raise exception 'ledger customer must match pos sale customer' using errcode = '23514';
    end if;

    if new.location_id is not null and v_pos_sale.location_id <> new.location_id then
      raise exception 'ledger location must match pos sale location' using errcode = '23514';
    end if;
  end if;

  if new.pos_sale_item_id is not null then
    select * into v_pos_sale_item
    from public.pos_sale_items i
    where i.id = new.pos_sale_item_id;

    if not found then
      raise exception 'pos sale item % not found', new.pos_sale_item_id using errcode = 'P0002';
    end if;

    if v_pos_sale_item.item_type <> 'package' then
      raise exception 'pos sale item must be package type for package ledger entry' using errcode = '23514';
    end if;

    if v_pos_sale_item.studio_id <> new.studio_id then
      raise exception 'pos sale item must belong to studio %', new.studio_id using errcode = '23514';
    end if;

    if v_pos_sale_item.package_id is distinct from new.package_id then
      raise exception 'ledger package must match pos sale item package' using errcode = '23514';
    end if;

    if new.pos_sale_id is not null and v_pos_sale_item.sale_id <> new.pos_sale_id then
      raise exception 'pos sale item must belong to provided pos sale' using errcode = '23514';
    end if;

    if new.location_id is not null and v_pos_sale_item.location_id <> new.location_id then
      raise exception 'ledger location must match pos sale item location' using errcode = '23514';
    end if;
  end if;

  if new.payment_id is not null then
    select * into v_payment
    from public.payments p
    where p.id = new.payment_id;

    if not found then
      raise exception 'payment % not found', new.payment_id using errcode = 'P0002';
    end if;

    if v_payment.studio_id is distinct from new.studio_id then
      raise exception 'payment must belong to studio %', new.studio_id using errcode = '23514';
    end if;

    if new.location_id is not null and v_payment.location_id is distinct from new.location_id then
      raise exception 'ledger location must match payment location' using errcode = '23514';
    end if;

    if new.pos_sale_id is not null and v_payment.pos_sale_id is distinct from new.pos_sale_id then
      raise exception 'payment must belong to provided pos sale' using errcode = '23514';
    end if;

    if new.pos_sale_id is null and new.pos_sale_item_id is not null and v_payment.pos_sale_id is distinct from v_pos_sale_item.sale_id then
      raise exception 'payment must belong to pos sale of provided item' using errcode = '23514';
    end if;
  end if;

  if new.audit_log_id is not null then
    select studio_id
    into v_audit_studio
    from public.strong_audit_logs a
    where a.id = new.audit_log_id;

    if v_audit_studio is null then
      raise exception 'audit log % not found', new.audit_log_id using errcode = 'P0002';
    end if;

    if v_audit_studio <> new.studio_id then
      raise exception 'audit log must belong to studio %', new.studio_id using errcode = '23514';
    end if;
  end if;

  if new.idempotency_key_id is not null then
    select studio_id
    into v_idempotency_studio
    from public.business_idempotency_keys ik
    where ik.id = new.idempotency_key_id;

    if v_idempotency_studio is null then
      raise exception 'idempotency key % not found', new.idempotency_key_id using errcode = 'P0002';
    end if;

    if v_idempotency_studio <> new.studio_id then
      raise exception 'idempotency key must belong to studio %', new.studio_id using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_package_ledger_validate_refs_trg on public.client_package_ledger_entries;
create trigger client_package_ledger_validate_refs_trg
  before insert or update of studio_id, location_id, client_package_id, salon_customer_id, package_id, pos_sale_id, pos_sale_item_id, payment_id, audit_log_id, idempotency_key_id
  on public.client_package_ledger_entries
  for each row execute function public.client_package_ledger_validate_refs();

create or replace function public.client_package_ledger_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'client_package_ledger_entries is append-only' using errcode = 'P0001';
end;
$$;

drop trigger if exists client_package_ledger_no_update_trg on public.client_package_ledger_entries;
create trigger client_package_ledger_no_update_trg
  before update on public.client_package_ledger_entries
  for each row execute function public.client_package_ledger_append_only_guard();

drop trigger if exists client_package_ledger_no_delete_trg on public.client_package_ledger_entries;
create trigger client_package_ledger_no_delete_trg
  before delete on public.client_package_ledger_entries
  for each row execute function public.client_package_ledger_append_only_guard();

alter table public.client_package_ledger_entries enable row level security;

revoke all on table public.client_package_ledger_entries from public;
revoke all on table public.client_package_ledger_entries from anon;
revoke all on table public.client_package_ledger_entries from authenticated;
grant all on table public.client_package_ledger_entries to service_role;
