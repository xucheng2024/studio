-- PKG-01 batch 4: deferred value valuation view + RPC (remaining credits * unit purchase snapshot).

create table if not exists public.pkg01_deferred_value_conflicts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_client_package_id uuid not null references public.client_packages(id) on delete cascade,
  salon_customer_id uuid references public.salon_customers(id) on delete set null,
  package_id uuid not null references public.packages(id) on delete restrict,
  conflict_code text not null
    check (conflict_code = any (array[
      'missing_salon_customer'::text,
      'multiple_salon_customers'::text,
      'missing_unit_price_snapshot'::text,
      'invalid_unit_price_snapshot'::text
    ])),
  details jsonb,
  status text not null default 'open'
    check (status = any (array['open'::text, 'resolved'::text, 'ignored'::text])),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists pkg01_deferred_value_conflicts_open_unique
  on public.pkg01_deferred_value_conflicts (studio_id, source_client_package_id, conflict_code)
  where status = 'open';

create index if not exists idx_pkg01_deferred_value_conflicts_studio_status
  on public.pkg01_deferred_value_conflicts (studio_id, status, created_at desc);

alter table public.pkg01_deferred_value_conflicts enable row level security;

revoke all on table public.pkg01_deferred_value_conflicts from public;
revoke all on table public.pkg01_deferred_value_conflicts from anon;
revoke all on table public.pkg01_deferred_value_conflicts from authenticated;
grant all on table public.pkg01_deferred_value_conflicts to service_role;

create or replace function public.pkg01_deferred_value_candidates(
  p_as_of timestamptz default null,
  p_studio_id uuid default null,
  p_package_id uuid default null
)
returns table (
  studio_id uuid,
  customer_id uuid,
  package_id uuid,
  client_package_id uuid,
  as_of timestamptz,
  remaining_credits integer,
  unit_price_snapshot numeric(12,6),
  deferred_value numeric(14,2),
  currency text,
  valuation_source text,
  conflict_code text,
  conflict_details jsonb
)
language sql
security definer
set search_path to 'public'
as $fn$
  with params as (
    select coalesce(p_as_of, now()) as as_of_ts
  ),
  base as (
    select
      pkg.studio_id,
      cp.id as client_package_id,
      cp.client_id,
      cp.package_id,
      cp.credits_left as current_credits_left,
      cp.package_credits_snapshot,
      cp.created_at as client_package_created_at,
      pkg.price as package_price,
      pkg.credits as package_credits,
      coalesce(cm.customer_match_count, 0) as customer_match_count,
      case when coalesce(cm.customer_match_count, 0) = 1 then cm.first_customer_id else null end as customer_id,
      pg.value_delta_amount as grant_value_delta_amount,
      pg.delta_credits as grant_delta_credits,
      pg.currency as grant_currency,
      lc.currency as ledger_currency,
      params.as_of_ts as as_of
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    cross join params
    left join lateral (
      select
        count(*)::integer as customer_match_count,
        (array_agg(sc.id order by sc.created_at asc, sc.id asc))[1] as first_customer_id
      from public.salon_customers sc
      where sc.studio_id = pkg.studio_id
        and sc.user_id = cp.client_id
        and sc.merged_into_id is null
    ) cm on true
    left join lateral (
      select
        le.value_delta_amount,
        le.delta_credits,
        le.currency
      from public.client_package_ledger_entries le
      where le.studio_id = pkg.studio_id
        and le.client_package_id = cp.id
        and le.event_type = 'purchase_grant'
      order by le.occurred_at asc, le.created_at asc, le.id asc
      limit 1
    ) pg on true
    left join lateral (
      select le.currency
      from public.client_package_ledger_entries le
      where le.studio_id = pkg.studio_id
        and le.client_package_id = cp.id
      order by le.occurred_at asc, le.created_at asc, le.id asc
      limit 1
    ) lc on true
    where (p_studio_id is null or pkg.studio_id = p_studio_id)
      and (p_package_id is null or cp.package_id = p_package_id)
      and cp.created_at <= params.as_of_ts
  ),
  with_balances as (
    select
      b.*,
      greatest(
        0,
        case
          when b.as_of >= now() - interval '1 second' then b.current_credits_left
          else coalesce((
            select le.balance_after
            from public.client_package_ledger_entries le
            where le.studio_id = b.studio_id
              and le.client_package_id = b.client_package_id
              and le.occurred_at <= b.as_of
            order by le.occurred_at desc, le.created_at desc, le.id desc
            limit 1
          ), b.current_credits_left)
        end
      )::integer as remaining_credits
    from base b
  ),
  valued as (
    select
      wb.*,
      case
        when wb.grant_delta_credits > 0
          and wb.grant_value_delta_amount is not null
          then round((wb.grant_value_delta_amount / wb.grant_delta_credits::numeric), 6)
        when coalesce(wb.package_credits_snapshot, 0) > 0
          and wb.package_price is not null
          and wb.package_price >= 0
          then round((wb.package_price / wb.package_credits_snapshot::numeric), 6)
        when coalesce(wb.package_credits, 0) > 0
          and wb.package_price is not null
          and wb.package_price >= 0
          then round((wb.package_price / wb.package_credits::numeric), 6)
        else null::numeric
      end as unit_price_snapshot,
      case
        when wb.grant_delta_credits > 0
          and wb.grant_value_delta_amount is not null then 'purchase_grant_snapshot'
        when coalesce(wb.package_credits_snapshot, 0) > 0
          and wb.package_price is not null
          and wb.package_price >= 0 then 'fallback_package_price_per_snapshot_credit'
        when coalesce(wb.package_credits, 0) > 0
          and wb.package_price is not null
          and wb.package_price >= 0 then 'fallback_package_price_per_current_credit'
        else null
      end as valuation_source
    from with_balances wb
  )
  select
    v.studio_id,
    v.customer_id,
    v.package_id,
    v.client_package_id,
    v.as_of,
    v.remaining_credits,
    v.unit_price_snapshot::numeric(12,6),
    round(v.remaining_credits::numeric * coalesce(v.unit_price_snapshot, 0), 2)::numeric(14,2) as deferred_value,
    coalesce(v.grant_currency, v.ledger_currency, 'SGD') as currency,
    v.valuation_source,
    case
      when v.remaining_credits <= 0 then null
      when v.customer_match_count = 0 then 'missing_salon_customer'
      when v.customer_match_count > 1 then 'multiple_salon_customers'
      when v.unit_price_snapshot is null then 'missing_unit_price_snapshot'
      when v.unit_price_snapshot < 0 then 'invalid_unit_price_snapshot'
      else null
    end as conflict_code,
    case
      when v.remaining_credits <= 0 then null
      when v.customer_match_count = 0 then jsonb_build_object(
        'clientId', v.client_id,
        'packageId', v.package_id,
        'remainingCredits', v.remaining_credits
      )
      when v.customer_match_count > 1 then jsonb_build_object(
        'clientId', v.client_id,
        'packageId', v.package_id,
        'customerCount', v.customer_match_count,
        'remainingCredits', v.remaining_credits
      )
      when v.unit_price_snapshot is null then jsonb_build_object(
        'clientPackageId', v.client_package_id,
        'grantValueDeltaAmount', v.grant_value_delta_amount,
        'grantDeltaCredits', v.grant_delta_credits,
        'packagePrice', v.package_price,
        'packageCreditsSnapshot', v.package_credits_snapshot,
        'packageCredits', v.package_credits,
        'remainingCredits', v.remaining_credits
      )
      when v.unit_price_snapshot < 0 then jsonb_build_object(
        'clientPackageId', v.client_package_id,
        'unitPriceSnapshot', v.unit_price_snapshot,
        'remainingCredits', v.remaining_credits
      )
      else null
    end as conflict_details
  from valued v
  where v.remaining_credits > 0;
$fn$;

revoke all on function public.pkg01_deferred_value_candidates(timestamptz, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.pkg01_deferred_value_candidates(timestamptz, uuid, uuid)
  to service_role;

create or replace view public.pkg01_deferred_value_rows as
select
  studio_id,
  customer_id,
  package_id,
  client_package_id,
  as_of,
  remaining_credits,
  unit_price_snapshot,
  deferred_value,
  currency,
  valuation_source
from public.pkg01_deferred_value_candidates(
  p_as_of := null,
  p_studio_id := null,
  p_package_id := null
)
where conflict_code is null;

revoke all on table public.pkg01_deferred_value_rows from public;
revoke all on table public.pkg01_deferred_value_rows from anon;
revoke all on table public.pkg01_deferred_value_rows from authenticated;
grant select on table public.pkg01_deferred_value_rows to service_role;

create or replace function public.get_pkg01_deferred_value(
  p_studio_id uuid default null,
  p_customer_id uuid default null,
  p_package_id uuid default null,
  p_as_of timestamptz default null,
  p_limit integer default 5000,
  p_refresh_conflicts boolean default true,
  p_actor_id uuid default null
)
returns table (
  studio_id uuid,
  customer_id uuid,
  package_id uuid,
  client_package_id uuid,
  as_of timestamptz,
  remaining_credits integer,
  unit_price_snapshot numeric(12,6),
  deferred_value numeric(14,2),
  currency text,
  valuation_source text
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 5000), 50000));
begin
  if p_refresh_conflicts then
    with conflicts as (
      select
        c.studio_id,
        c.client_package_id,
        c.customer_id,
        c.package_id,
        c.conflict_code,
        c.conflict_details
      from public.pkg01_deferred_value_candidates(
        p_as_of := p_as_of,
        p_studio_id := p_studio_id,
        p_package_id := p_package_id
      ) c
      where c.conflict_code is not null
    )
    insert into public.pkg01_deferred_value_conflicts (
      studio_id,
      source_client_package_id,
      salon_customer_id,
      package_id,
      conflict_code,
      details
    )
    select
      c.studio_id,
      c.client_package_id,
      c.customer_id,
      c.package_id,
      c.conflict_code,
      c.conflict_details
    from conflicts c
    on conflict do nothing;

    with conflicts as (
      select
        c.studio_id,
        c.client_package_id,
        c.conflict_code
      from public.pkg01_deferred_value_candidates(
        p_as_of := p_as_of,
        p_studio_id := p_studio_id,
        p_package_id := p_package_id
      ) c
      where c.conflict_code is not null
    )
    update public.pkg01_deferred_value_conflicts dvc
    set
      status = 'resolved',
      resolved_at = now(),
      resolved_by = p_actor_id
    where dvc.status = 'open'
      and (p_studio_id is null or dvc.studio_id = p_studio_id)
      and (p_package_id is null or dvc.package_id = p_package_id)
      and dvc.conflict_code = any (array[
        'missing_salon_customer'::text,
        'multiple_salon_customers'::text,
        'missing_unit_price_snapshot'::text,
        'invalid_unit_price_snapshot'::text
      ])
      and not exists (
        select 1
        from conflicts c
        where c.studio_id = dvc.studio_id
          and c.client_package_id = dvc.source_client_package_id
          and c.conflict_code = dvc.conflict_code
      );
  end if;

  return query
  select
    c.studio_id,
    c.customer_id,
    c.package_id,
    c.client_package_id,
    c.as_of,
    c.remaining_credits,
    c.unit_price_snapshot,
    c.deferred_value,
    c.currency,
    c.valuation_source
  from public.pkg01_deferred_value_candidates(
    p_as_of := p_as_of,
    p_studio_id := p_studio_id,
    p_package_id := p_package_id
  ) c
  where c.conflict_code is null
    and (p_customer_id is null or c.customer_id = p_customer_id)
  order by c.studio_id, c.customer_id, c.package_id, c.client_package_id
  limit v_limit;
end;
$fn$;

revoke all on function public.get_pkg01_deferred_value(uuid, uuid, uuid, timestamptz, integer, boolean, uuid)
  from public, anon, authenticated;

grant execute on function public.get_pkg01_deferred_value(uuid, uuid, uuid, timestamptz, integer, boolean, uuid)
  to service_role;
