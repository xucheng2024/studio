-- POS-01 batch 1: POS sale fact skeleton.
-- Scope: foundational tables/constraints/indexes only.

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid references public.salon_customers(id) on delete set null,
  cashier_user_id uuid references public.users(id) on delete set null,
  sale_number text,
  receipt_number text,
  status text not null default 'draft'
    check (status = any (array[
      'draft'::text,
      'pending_payment'::text,
      'paid'::text,
      'partially_refunded'::text,
      'refunded'::text,
      'voided'::text
    ])),
  currency text not null default 'SGD'
    check (currency ~ '^[A-Z]{3}$'::text),
  subtotal_amount numeric(12,2) not null default 0
    check (subtotal_amount >= 0),
  discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0),
  tax_amount numeric(12,2) not null default 0
    check (tax_amount >= 0),
  total_amount numeric(12,2) not null default 0
    check (total_amount >= 0),
  refunded_amount numeric(12,2) not null default 0
    check (refunded_amount >= 0),
  note text,
  locked_at timestamptz,
  submitted_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_sales_totals_check check (
    discount_amount <= subtotal_amount
    and (subtotal_amount - discount_amount + tax_amount) = total_amount
    and refunded_amount <= total_amount
  )
);

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  item_type text not null
    check (item_type = any (array['service'::text, 'product'::text, 'package'::text])),
  service_id uuid references public.studio_services(id) on delete restrict,
  product_id uuid references public.shop_products(id) on delete restrict,
  package_id uuid references public.packages(id) on delete restrict,
  salon_appointment_id uuid references public.salon_appointments(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  item_name_snapshot text not null,
  item_currency_snapshot text not null
    check (item_currency_snapshot ~ '^[A-Z]{3}$'::text),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_amount numeric(12,2) not null check (unit_price_amount >= 0),
  subtotal_amount numeric(12,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  refunded_quantity numeric(12,3) not null default 0 check (refunded_quantity >= 0),
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_sale_items_source_type_check check (
    (
      item_type = 'service'
      and service_id is not null
      and product_id is null
      and package_id is null
    )
    or (
      item_type = 'product'
      and service_id is null
      and product_id is not null
      and package_id is null
    )
    or (
      item_type = 'package'
      and service_id is null
      and product_id is null
      and package_id is not null
    )
  ),
  constraint pos_sale_items_totals_check check (
    discount_amount <= subtotal_amount
    and (subtotal_amount - discount_amount + tax_amount) = total_amount
    and refunded_quantity <= quantity
    and refunded_amount <= total_amount
  )
);

create unique index if not exists pos_sales_studio_sale_number_unique
  on public.pos_sales (studio_id, sale_number)
  where sale_number is not null;

create unique index if not exists pos_sales_studio_receipt_number_unique
  on public.pos_sales (studio_id, receipt_number)
  where receipt_number is not null;

create index if not exists idx_pos_sales_studio_location_created
  on public.pos_sales (studio_id, location_id, created_at desc);

create index if not exists idx_pos_sales_location_status_created
  on public.pos_sales (location_id, status, created_at desc);

create index if not exists idx_pos_sales_customer_created
  on public.pos_sales (salon_customer_id, created_at desc)
  where salon_customer_id is not null;

create unique index if not exists pos_sale_items_sale_line_unique
  on public.pos_sale_items (sale_id, line_number);

create index if not exists idx_pos_sale_items_studio_location_created
  on public.pos_sale_items (studio_id, location_id, created_at desc);

create index if not exists idx_pos_sale_items_service
  on public.pos_sale_items (service_id)
  where service_id is not null;

create index if not exists idx_pos_sale_items_product
  on public.pos_sale_items (product_id)
  where product_id is not null;

create index if not exists idx_pos_sale_items_package
  on public.pos_sale_items (package_id)
  where package_id is not null;

create index if not exists idx_pos_sale_items_employee
  on public.pos_sale_items (employee_id)
  where employee_id is not null;

create index if not exists idx_pos_sale_items_appointment
  on public.pos_sale_items (salon_appointment_id)
  where salon_appointment_id is not null;


create or replace function public.pos_sales_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_customer_studio uuid;
begin
  select studio_id into v_location_studio
  from public.locations
  where id = new.location_id;

  if v_location_studio is null or v_location_studio <> new.studio_id then
    raise exception 'pos_sales.location_id must belong to studio %', new.studio_id
      using errcode = '23514';
  end if;

  if new.salon_customer_id is not null then
    select studio_id into v_customer_studio
    from public.salon_customers
    where id = new.salon_customer_id;

    if v_customer_studio is null or v_customer_studio <> new.studio_id then
      raise exception 'pos_sales.salon_customer_id must belong to studio %', new.studio_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pos_sales_validate_refs_trg on public.pos_sales;
create trigger pos_sales_validate_refs_trg
  before insert or update of studio_id, location_id, salon_customer_id on public.pos_sales
  for each row execute function public.pos_sales_validate_refs();


create or replace function public.pos_sale_items_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale record;
  v_source_studio uuid;
  v_employee_studio uuid;
  v_appointment record;
begin
  select studio_id, location_id
  into v_sale
  from public.pos_sales
  where id = new.sale_id;

  if not found then
    raise exception 'pos_sale_items.sale_id % does not exist', new.sale_id
      using errcode = '23503';
  end if;

  if v_sale.studio_id <> new.studio_id or v_sale.location_id <> new.location_id then
    raise exception 'pos_sale_items studio/location must match parent sale'
      using errcode = '23514';
  end if;

  if new.service_id is not null then
    select studio_id into v_source_studio
    from public.studio_services
    where id = new.service_id;

    if v_source_studio is null or v_source_studio <> new.studio_id then
      raise exception 'service item must belong to studio %', new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.product_id is not null then
    select studio_id into v_source_studio
    from public.shop_products
    where id = new.product_id;

    if v_source_studio is null or v_source_studio <> new.studio_id then
      raise exception 'product item must belong to studio %', new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.package_id is not null then
    select studio_id into v_source_studio
    from public.packages
    where id = new.package_id;

    if v_source_studio is null or v_source_studio <> new.studio_id then
      raise exception 'package item must belong to studio %', new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.employee_id is not null then
    select studio_id into v_employee_studio
    from public.employees
    where id = new.employee_id;

    if v_employee_studio is null or v_employee_studio <> new.studio_id then
      raise exception 'employee must belong to studio %', new.studio_id
        using errcode = '23514';
    end if;
  end if;

  if new.salon_appointment_id is not null then
    select studio_id, location_id
    into v_appointment
    from public.salon_appointments
    where id = new.salon_appointment_id;

    if not found then
      raise exception 'appointment % does not exist', new.salon_appointment_id
        using errcode = '23503';
    end if;

    if v_appointment.studio_id <> new.studio_id or v_appointment.location_id <> new.location_id then
      raise exception 'appointment must match item studio/location'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pos_sale_items_validate_refs_trg on public.pos_sale_items;
create trigger pos_sale_items_validate_refs_trg
  before insert or update of sale_id, studio_id, location_id, service_id, product_id, package_id, employee_id, salon_appointment_id on public.pos_sale_items
  for each row execute function public.pos_sale_items_validate_refs();


-- public.set_updated_at_timestamp() already exists (124_employee_foundation.sql).
drop trigger if exists set_pos_sales_updated_at on public.pos_sales;
create trigger set_pos_sales_updated_at
  before update on public.pos_sales
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists set_pos_sale_items_updated_at on public.pos_sale_items;
create trigger set_pos_sale_items_updated_at
  before update on public.pos_sale_items
  for each row execute function public.set_updated_at_timestamp();


alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;

revoke all on table public.pos_sales from public;
revoke all on table public.pos_sales from anon;
revoke all on table public.pos_sales from authenticated;
grant all on table public.pos_sales to service_role;

revoke all on table public.pos_sale_items from public;
revoke all on table public.pos_sale_items from anon;
revoke all on table public.pos_sale_items from authenticated;
grant all on table public.pos_sale_items to service_role;

