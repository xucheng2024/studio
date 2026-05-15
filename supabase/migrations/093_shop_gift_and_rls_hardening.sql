-- Hardening patch after 092:
-- 1) Ensure shop_orders status constraints are deterministic and safe.
-- 2) Fix RLS policies to avoid locking owner/manager dashboard workflows.

-- Remove only the order-status check constraint(s), never fulfillment checks.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.shop_orders'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%status%'
      and pg_get_constraintdef(c.oid) not like '%fulfillment_status%'
  loop
    execute 'alter table public.shop_orders drop constraint ' || quote_ident(r.conname);
  end loop;
end $$;

alter table public.shop_orders
add constraint shop_orders_status_check
check (status = any (array[
  'pending'::text,
  'processing'::text,
  'paid'::text,
  'failed'::text,
  'expired'::text,
  'refunded'::text
]));

-- Ensure fulfillment check exists even if a previous migration accidentally removed it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shop_orders'::regclass
      and conname = 'shop_orders_fulfillment_status_check'
  ) then
    alter table public.shop_orders
    add constraint shop_orders_fulfillment_status_check
    check (fulfillment_status = any (array[
      'unfulfilled'::text,
      'shipped'::text,
      'cancelled'::text
    ]));
  end if;
end $$;

alter table public.shop_products enable row level security;
alter table public.shop_orders enable row level security;

drop policy if exists "shop_products_anon_read_active" on public.shop_products;
drop policy if exists "shop_products_public_read_active" on public.shop_products;
drop policy if exists "shop_products_staff_write_all" on public.shop_products;
drop policy if exists "shop_products_staff_read_all" on public.shop_products;

create policy "shop_products_public_read_active"
  on public.shop_products
  for select
  using (is_active = true);

create policy "shop_products_staff_read_all"
  on public.shop_products
  for select
  using (
    exists (
      select 1
      from public.studios s
      where s.id = shop_products.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  );

create policy "shop_products_staff_write_all"
  on public.shop_products
  for all
  using (
    exists (
      select 1
      from public.studios s
      where s.id = shop_products.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.studios s
      where s.id = shop_products.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  );

drop policy if exists "shop_orders_owner_select" on public.shop_orders;
drop policy if exists "shop_orders_staff_read_all" on public.shop_orders;
drop policy if exists "shop_orders_staff_update" on public.shop_orders;

create policy "shop_orders_owner_select"
  on public.shop_orders
  for select
  using (client_id = auth.uid());

create policy "shop_orders_staff_read_all"
  on public.shop_orders
  for select
  using (
    exists (
      select 1
      from public.studios s
      where s.id = shop_orders.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  );

create policy "shop_orders_staff_update"
  on public.shop_orders
  for update
  using (
    exists (
      select 1
      from public.studios s
      where s.id = shop_orders.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.studios s
      where s.id = shop_orders.studio_id
        and (
          s.owner_id = auth.uid()
          or exists (
            select 1
            from public.staff_memberships sm
            where sm.studio_id = s.id
              and sm.user_id = auth.uid()
              and sm.is_active = true
              and sm.role = any (array['owner'::text, 'manager'::text])
          )
        )
    )
  );
