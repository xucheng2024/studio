-- PKG-02 prep: guest identity strategy for package grants.
-- Goal: avoid frontdesk blocking when sale customer exists but user_id is null.
-- Approach: defer grant into queue, then auto-process when salon_customer.user_id is linked.

create table if not exists public.pkg02_guest_package_grant_queue (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null references public.salon_customers(id) on delete cascade,
  pos_sale_id uuid not null references public.pos_sales(id) on delete cascade,
  pos_sale_item_id uuid not null references public.pos_sale_items(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'resolved'::text, 'failed'::text, 'ignored'::text])),
  defer_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempted_at timestamptz,
  last_error text,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, pos_sale_item_id)
);

create index if not exists idx_pkg02_guest_grant_queue_pending
  on public.pkg02_guest_package_grant_queue (studio_id, status, created_at asc)
  where status = 'pending';

create index if not exists idx_pkg02_guest_grant_queue_customer
  on public.pkg02_guest_package_grant_queue (salon_customer_id, status, created_at asc);

alter table public.pkg02_guest_package_grant_queue enable row level security;

revoke all on table public.pkg02_guest_package_grant_queue from public;
revoke all on table public.pkg02_guest_package_grant_queue from anon;
revoke all on table public.pkg02_guest_package_grant_queue from authenticated;
grant all on table public.pkg02_guest_package_grant_queue to service_role;

drop trigger if exists set_pkg02_guest_package_grant_queue_updated_at on public.pkg02_guest_package_grant_queue;
create trigger set_pkg02_guest_package_grant_queue_updated_at
  before update on public.pkg02_guest_package_grant_queue
  for each row execute function public.set_updated_at_timestamp();

create or replace function public.pkg01_apply_sale_package_grants(
  p_studio_id uuid,
  p_sale_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_idempotency_key_id uuid default null,
  p_provider_event_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale public.pos_sales;
  v_payment public.payments;
  v_item public.pos_sale_items;
  v_package public.packages;
  v_customer public.salon_customers;
  v_existing public.client_package_ledger_entries;
  v_client_package_id uuid;
  v_qty_int integer;
  v_delta_credits integer;
  v_expiry_at timestamptz;
  v_audit_id uuid;
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_grants jsonb := '[]'::jsonb;
  v_row_id uuid;
  v_actor_type text := case when coalesce(p_actor_role, '') = 'hitpay_webhook' then 'system' else 'user' end;
  v_deferred_count integer := 0;
  v_deferred_items jsonb := '[]'::jsonb;
begin
  select *
  into v_sale
  from public.pos_sales s
  where s.id = p_sale_id
    and s.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale % not found in studio %', p_sale_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_sale.status <> 'paid' and v_sale.status <> 'partially_refunded' and v_sale.status <> 'refunded' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_not_paid');
  end if;

  if v_sale.salon_customer_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'sale_without_salon_customer');
  end if;

  select *
  into v_customer
  from public.salon_customers c
  where c.id = v_sale.salon_customer_id
    and c.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'sale customer % not found in studio %', v_sale.salon_customer_id, p_studio_id using errcode = 'P0002';
  end if;

  select *
  into v_payment
  from public.payments p
  where p.studio_id = p_studio_id
    and p.pos_sale_id = p_sale_id
  order by p.created_at desc
  limit 1;

  for v_item in
    select *
    from public.pos_sale_items i
    where i.sale_id = p_sale_id
      and i.studio_id = p_studio_id
      and i.item_type = 'package'
    order by i.line_number, i.id
  loop
    select *
    into v_existing
    from public.client_package_ledger_entries le
    where le.studio_id = p_studio_id
      and le.event_type = 'purchase_grant'
      and le.source_type = 'pos_sale_item_grant'
      and le.source_id = v_item.id
    order by le.created_at asc
    limit 1;

    if found then
      continue;
    end if;

    if v_customer.user_id is null then
      insert into public.pkg02_guest_package_grant_queue (
        studio_id,
        salon_customer_id,
        pos_sale_id,
        pos_sale_item_id,
        package_id,
        status,
        defer_reason,
        metadata
      ) values (
        p_studio_id,
        v_sale.salon_customer_id,
        v_sale.id,
        v_item.id,
        v_item.package_id,
        'pending',
        'salon_customer_user_id_missing',
        jsonb_build_object(
          'saleId', v_sale.id,
          'saleItemId', v_item.id,
          'packageId', v_item.package_id,
          'customerId', v_sale.salon_customer_id
        )
      )
      on conflict (studio_id, pos_sale_item_id)
      do update set
        status = case
          when public.pkg02_guest_package_grant_queue.status = 'resolved' then 'resolved'
          else 'pending'
        end,
        defer_reason = excluded.defer_reason,
        metadata = public.pkg02_guest_package_grant_queue.metadata || excluded.metadata,
        updated_at = now();

      v_deferred_count := v_deferred_count + 1;
      v_deferred_items := v_deferred_items || jsonb_build_array(jsonb_build_object(
        'saleItemId', v_item.id,
        'packageId', v_item.package_id,
        'reason', 'salon_customer_user_id_missing'
      ));
      continue;
    end if;

    select *
    into v_package
    from public.packages pkg
    where pkg.id = v_item.package_id
      and pkg.studio_id = p_studio_id;

    if not found then
      raise exception 'package % not found in studio %', v_item.package_id, p_studio_id using errcode = 'P0002';
    end if;

    if round(coalesce(v_item.quantity, 0)::numeric, 3) <> trunc(coalesce(v_item.quantity, 0)) then
      raise exception 'package sale item % quantity must be an integer to grant credits', v_item.id using errcode = '23514';
    end if;

    v_qty_int := trunc(v_item.quantity);
    if v_qty_int <= 0 then
      raise exception 'package sale item % quantity must be > 0', v_item.id using errcode = '23514';
    end if;

    v_delta_credits := v_package.credits * v_qty_int;
    if v_delta_credits <= 0 then
      raise exception 'computed package grant credits must be > 0 for item %', v_item.id using errcode = '23514';
    end if;

    v_expiry_at := case
      when v_package.expiry_days is null then null
      else coalesce(v_sale.paid_at, now()) + make_interval(days => v_package.expiry_days)
    end;

    insert into public.client_packages (
      id,
      client_id,
      package_id,
      credits_left,
      expiry_date,
      created_at,
      package_name_snapshot,
      package_credits_snapshot,
      package_expiry_days_snapshot
    ) values (
      gen_random_uuid(),
      v_customer.user_id,
      v_package.id,
      v_delta_credits,
      v_expiry_at,
      now(),
      coalesce(v_item.item_name_snapshot, v_package.name),
      v_package.credits,
      v_package.expiry_days
    )
    returning id into v_client_package_id;

    insert into public.client_package_ledger_entries (
      studio_id,
      location_id,
      client_package_id,
      salon_customer_id,
      package_id,
      pos_sale_id,
      pos_sale_item_id,
      payment_id,
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
      v_sale.location_id,
      v_client_package_id,
      v_sale.salon_customer_id,
      v_package.id,
      v_sale.id,
      v_item.id,
      v_payment.id,
      'purchase_grant',
      'pos_sale_item_grant',
      v_item.id,
      v_delta_credits,
      0,
      v_delta_credits,
      v_sale.currency,
      round(coalesce(v_item.total_amount, 0)::numeric, 2),
      'POS package sale paid grant',
      jsonb_build_object(
        'saleId', v_sale.id,
        'saleItemId', v_item.id,
        'quantity', v_item.quantity,
        'packageCreditsPerUnit', v_package.credits
      ),
      p_idempotency_key_id,
      p_actor_id,
      coalesce(v_sale.paid_at, now())
    )
    returning id into v_row_id;

    v_inserted_ids := array_append(v_inserted_ids, v_row_id);
    v_grants := v_grants || jsonb_build_array(jsonb_build_object(
      'saleItemId', v_item.id,
      'clientPackageId', v_client_package_id,
      'deltaCredits', v_delta_credits,
      'packageId', v_package.id
    ));

    update public.pkg02_guest_package_grant_queue q
    set
      status = 'resolved',
      defer_reason = null,
      last_error = null,
      resolved_at = now(),
      resolved_by = p_actor_id,
      updated_at = now()
    where q.studio_id = p_studio_id
      and q.pos_sale_item_id = v_item.id
      and q.status <> 'resolved';
  end loop;

  if cardinality(v_inserted_ids) = 0 then
    if v_deferred_count > 0 then
      return jsonb_build_object(
        'ok', true,
        'grants_created', 0,
        'grants_deferred', v_deferred_count,
        'deferred_items', v_deferred_items,
        'deferred_reason', 'salon_customer_user_id_missing'
      );
    end if;

    return jsonb_build_object('ok', true, 'grants_created', 0, 'already_processed', true);
  end if;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pkg01_package_grant_applied',
    p_target_type := 'pos_sale',
    p_actor_type := v_actor_type,
    p_location_id := v_sale.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_sale.id,
    p_before_state := jsonb_build_object(
      'saleId', v_sale.id,
      'status', v_sale.status
    ),
    p_after_state := jsonb_build_object(
      'saleId', v_sale.id,
      'grants', v_grants,
      'grantsDeferred', v_deferred_count,
      'deferredItems', v_deferred_items
    ),
    p_correlation_id := p_correlation_id,
    p_idempotency_key_id := p_idempotency_key_id,
    p_provider_event_id := p_provider_event_id
  );

  return jsonb_build_object(
    'ok', true,
    'grants_created', cardinality(v_inserted_ids),
    'grants_deferred', v_deferred_count,
    'deferred_items', v_deferred_items,
    'audit_log_id', v_audit_id
  );
end;
$$;

revoke all on function public.pkg01_apply_sale_package_grants(uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.pkg01_apply_sale_package_grants(uuid, uuid, uuid, text, uuid, uuid, text)
  to service_role;

create or replace function public.pkg02_process_guest_package_grant_queue(
  p_studio_id uuid default null,
  p_salon_customer_id uuid default null,
  p_limit integer default 200,
  p_actor_id uuid default null,
  p_actor_role text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 5000));
  v_scanned integer := 0;
  v_resolved integer := 0;
  v_failed integer := 0;
begin
  for v_row in
    select
      q.id,
      q.studio_id,
      q.salon_customer_id,
      q.pos_sale_id,
      q.pos_sale_item_id,
      q.attempts,
      sc.user_id
    from public.pkg02_guest_package_grant_queue q
    join public.salon_customers sc on sc.id = q.salon_customer_id
    where q.status = 'pending'
      and (p_studio_id is null or q.studio_id = p_studio_id)
      and (p_salon_customer_id is null or q.salon_customer_id = p_salon_customer_id)
      and sc.user_id is not null
      and sc.merged_into_id is null
    order by q.created_at asc
    limit v_limit
    for update of q skip locked
  loop
    v_scanned := v_scanned + 1;

    begin
      perform public.pkg01_apply_sale_package_grants(
        p_studio_id := v_row.studio_id,
        p_sale_id := v_row.pos_sale_id,
        p_actor_id := coalesce(p_actor_id, v_row.user_id),
        p_actor_role := p_actor_role,
        p_correlation_id := concat('pkg02_guest_grant_queue:', v_row.id::text)
      );

      if exists (
        select 1
        from public.client_package_ledger_entries le
        where le.studio_id = v_row.studio_id
          and le.event_type = 'purchase_grant'
          and le.source_type = 'pos_sale_item_grant'
          and le.source_id = v_row.pos_sale_item_id
      ) then
        update public.pkg02_guest_package_grant_queue q
        set
          status = 'resolved',
          attempts = q.attempts + 1,
          last_attempted_at = now(),
          last_error = null,
          resolved_at = now(),
          resolved_by = coalesce(p_actor_id, v_row.user_id)
        where q.id = v_row.id;

        v_resolved := v_resolved + 1;
      else
        update public.pkg02_guest_package_grant_queue q
        set
          attempts = q.attempts + 1,
          last_attempted_at = now(),
          last_error = 'grant_not_created'
        where q.id = v_row.id;

        v_failed := v_failed + 1;
      end if;
    exception
      when others then
        update public.pkg02_guest_package_grant_queue q
        set
          attempts = q.attempts + 1,
          last_attempted_at = now(),
          last_error = left(sqlerrm, 1000)
        where q.id = v_row.id;

        v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'resolved', v_resolved,
    'failed', v_failed,
    'limit', v_limit
  );
end;
$$;

revoke all on function public.pkg02_process_guest_package_grant_queue(uuid, uuid, integer, uuid, text)
  from public, anon, authenticated;

grant execute on function public.pkg02_process_guest_package_grant_queue(uuid, uuid, integer, uuid, text)
  to service_role;

create or replace function public.pkg02_on_salon_customer_user_link_process_grant_queue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.user_id is not null then
    return new;
  end if;

  if new.user_id is null then
    return new;
  end if;

  if new.merged_into_id is not null then
    return new;
  end if;

  perform public.pkg02_process_guest_package_grant_queue(
    p_studio_id := new.studio_id,
    p_salon_customer_id := new.id,
    p_limit := 500,
    p_actor_id := new.user_id,
    p_actor_role := 'salon_customer_user_link_trigger'
  );

  return new;
end;
$$;

drop trigger if exists pkg02_on_salon_customer_user_link_process_grant_queue_trg on public.salon_customers;
create trigger pkg02_on_salon_customer_user_link_process_grant_queue_trg
  after update of user_id on public.salon_customers
  for each row execute function public.pkg02_on_salon_customer_user_link_process_grant_queue();

