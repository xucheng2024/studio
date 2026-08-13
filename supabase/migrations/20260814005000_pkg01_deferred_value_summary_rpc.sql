-- PKG-01 batch 5: deferred value summary RPC (reporting-friendly aggregation).

create or replace function public.get_pkg01_deferred_value_summary(
  p_studio_id uuid default null,
  p_location_id uuid default null,
  p_customer_id uuid default null,
  p_package_id uuid default null,
  p_as_of timestamptz default null,
  p_refresh_conflicts boolean default true,
  p_actor_id uuid default null
)
returns table (
  studio_id uuid,
  location_id uuid,
  as_of timestamptz,
  currency text,
  customer_count integer,
  package_count integer,
  row_count integer,
  total_remaining_credits bigint,
  total_deferred_value numeric(16,2)
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if p_refresh_conflicts then
    perform public.get_pkg01_deferred_value(
      p_studio_id := p_studio_id,
      p_customer_id := p_customer_id,
      p_package_id := p_package_id,
      p_as_of := p_as_of,
      p_limit := 1,
      p_refresh_conflicts := true,
      p_actor_id := p_actor_id
    );
  end if;

  return query
  with rows as (
    select
      c.studio_id,
      pkg.location_id,
      c.as_of,
      c.currency,
      c.customer_id,
      c.package_id,
      c.client_package_id,
      c.remaining_credits,
      c.deferred_value
    from public.pkg01_deferred_value_candidates(
      p_as_of := p_as_of,
      p_studio_id := p_studio_id,
      p_package_id := p_package_id
    ) c
    join public.packages pkg on pkg.id = c.package_id
    where c.conflict_code is null
      and (p_customer_id is null or c.customer_id = p_customer_id)
      and (p_location_id is null or pkg.location_id = p_location_id)
  )
  select
    r.studio_id,
    r.location_id,
    max(r.as_of) as as_of,
    r.currency,
    count(distinct r.customer_id)::integer as customer_count,
    count(distinct r.package_id)::integer as package_count,
    count(*)::integer as row_count,
    coalesce(sum(r.remaining_credits), 0)::bigint as total_remaining_credits,
    round(coalesce(sum(r.deferred_value), 0), 2)::numeric(16,2) as total_deferred_value
  from rows r
  group by r.studio_id, r.location_id, r.currency
  order by r.studio_id, r.location_id, r.currency;
end;
$fn$;

revoke all on function public.get_pkg01_deferred_value_summary(uuid, uuid, uuid, uuid, timestamptz, boolean, uuid)
  from public, anon, authenticated;

grant execute on function public.get_pkg01_deferred_value_summary(uuid, uuid, uuid, uuid, timestamptz, boolean, uuid)
  to service_role;
