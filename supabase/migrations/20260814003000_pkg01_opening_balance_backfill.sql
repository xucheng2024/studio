-- PKG-01 batch 3: opening balance backfill + conflict report (rerunnable).

create table if not exists public.pkg01_opening_balance_conflicts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_client_package_id uuid not null references public.client_packages(id) on delete cascade,
  conflict_code text not null
    check (conflict_code = any (array[
      'missing_salon_customer'::text,
      'multiple_salon_customers'::text,
      'invalid_credit_balance'::text,
      'existing_opening_balance'::text
    ])),
  details jsonb,
  status text not null default 'open'
    check (status = any (array['open'::text, 'resolved'::text, 'ignored'::text])),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists pkg01_opening_balance_conflicts_open_unique
  on public.pkg01_opening_balance_conflicts (studio_id, source_client_package_id, conflict_code)
  where status = 'open';

create index if not exists idx_pkg01_opening_balance_conflicts_studio_status
  on public.pkg01_opening_balance_conflicts (studio_id, status, created_at desc);

alter table public.pkg01_opening_balance_conflicts enable row level security;

revoke all on table public.pkg01_opening_balance_conflicts from public;
revoke all on table public.pkg01_opening_balance_conflicts from anon;
revoke all on table public.pkg01_opening_balance_conflicts from authenticated;
grant all on table public.pkg01_opening_balance_conflicts to service_role;

create or replace function public.backfill_pkg01_opening_balance(
  p_studio_id uuid default null,
  p_actor_id uuid default null,
  p_actor_role text default 'system',
  p_limit integer default 5000,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_salon_customer_id uuid;
  v_customer_count integer;
  v_inserted integer := 0;
  v_conflicts integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_zero integer := 0;
  v_scanned integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5000), 50000));
  v_now timestamptz := now();
  v_audit_id uuid;
  v_conflict_details jsonb;
begin
  for v_row in
    select
      cp.id as client_package_id,
      cp.client_id,
      cp.package_id,
      cp.credits_left,
      cp.expiry_date,
      cp.created_at as client_package_created_at,
      pkg.studio_id,
      pkg.location_id,
      pkg.name as package_name,
      pkg.price as package_price,
      pkg.credits as package_credits
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    where (p_studio_id is null or pkg.studio_id = p_studio_id)
    order by cp.created_at asc, cp.id asc
    limit v_limit
  loop
    v_scanned := v_scanned + 1;

    if coalesce(v_row.credits_left, 0) < 0 then
      insert into public.pkg01_opening_balance_conflicts (
        studio_id, source_client_package_id, conflict_code, details
      ) values (
        v_row.studio_id,
        v_row.client_package_id,
        'invalid_credit_balance',
        jsonb_build_object(
          'credits_left', v_row.credits_left,
          'client_id', v_row.client_id,
          'package_id', v_row.package_id
        )
      )
      on conflict do nothing;

      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if coalesce(v_row.credits_left, 0) = 0 then
      v_skipped_zero := v_skipped_zero + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.client_package_ledger_entries le
      where le.studio_id = v_row.studio_id
        and le.client_package_id = v_row.client_package_id
        and le.event_type = 'opening_balance'
        and le.source_type = 'client_package_opening_balance'
        and le.source_id = v_row.client_package_id
    ) then
      v_skipped_existing := v_skipped_existing + 1;
      continue;
    end if;

    select count(*)
    into v_customer_count
    from public.salon_customers sc
    where sc.studio_id = v_row.studio_id
      and sc.user_id = v_row.client_id
      and sc.merged_into_id is null;

    if v_customer_count = 1 then
      select sc.id
      into v_salon_customer_id
      from public.salon_customers sc
      where sc.studio_id = v_row.studio_id
        and sc.user_id = v_row.client_id
        and sc.merged_into_id is null
      order by sc.created_at asc, sc.id asc
      limit 1;
    else
      v_salon_customer_id := null;
    end if;

    if v_customer_count = 0 then
      insert into public.pkg01_opening_balance_conflicts (
        studio_id, source_client_package_id, conflict_code, details
      ) values (
        v_row.studio_id,
        v_row.client_package_id,
        'missing_salon_customer',
        jsonb_build_object(
          'client_id', v_row.client_id,
          'package_id', v_row.package_id
        )
      )
      on conflict do nothing;

      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if v_customer_count > 1 then
      insert into public.pkg01_opening_balance_conflicts (
        studio_id, source_client_package_id, conflict_code, details
      ) values (
        v_row.studio_id,
        v_row.client_package_id,
        'multiple_salon_customers',
        jsonb_build_object(
          'client_id', v_row.client_id,
          'customer_count', v_customer_count,
          'package_id', v_row.package_id
        )
      )
      on conflict do nothing;

      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    v_conflict_details := jsonb_build_object(
      'legacyClientPackageId', v_row.client_package_id,
      'clientId', v_row.client_id,
      'packageId', v_row.package_id,
      'copiedAt', v_now
    );

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
      v_row.studio_id,
      v_row.location_id,
      v_row.client_package_id,
      v_salon_customer_id,
      v_row.package_id,
      null,
      null,
      null,
      'opening_balance',
      'client_package_opening_balance',
      v_row.client_package_id,
      v_row.credits_left,
      0,
      v_row.credits_left,
      'SGD',
      null,
      'PKG-01 opening balance migration',
      v_conflict_details,
      null,
      p_actor_id,
      coalesce(v_row.client_package_created_at, v_now)
    );

    v_inserted := v_inserted + 1;

    v_audit_id := public.record_strong_audit(
      p_studio_id := v_row.studio_id,
      p_action := 'pkg01_opening_balance_backfilled',
      p_target_type := 'client_package',
      p_actor_type := case when p_actor_id is null then 'system' else 'user' end,
      p_location_id := v_row.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_row.client_package_id,
      p_before_state := jsonb_build_object(
        'clientPackageId', v_row.client_package_id,
        'creditsLeft', v_row.credits_left
      ),
      p_after_state := jsonb_build_object(
        'eventType', 'opening_balance',
        'deltaCredits', v_row.credits_left,
        'balanceAfter', v_row.credits_left
      ),
      p_correlation_id := 'pkg01_opening_balance_backfill'
    );

    -- Keep append-only guarantee: audit FK intentionally optional in batch write.
    perform v_audit_id;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'studio_id', p_studio_id,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'inserted', v_inserted,
    'skipped_existing', v_skipped_existing,
    'skipped_zero', v_skipped_zero,
    'conflicts', v_conflicts,
    'limit', v_limit
  );
end;
$$;

revoke all on function public.backfill_pkg01_opening_balance(uuid, uuid, text, integer, boolean)
  from public, anon, authenticated;

grant execute on function public.backfill_pkg01_opening_balance(uuid, uuid, text, integer, boolean)
  to service_role;
