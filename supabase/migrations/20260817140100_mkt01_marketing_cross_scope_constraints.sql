-- MKT-01 follow-up: enforce Studio ownership across marketing references.

create or replace function public.mkt01_validate_campaign_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations where id = new.location_id and studio_id = new.studio_id
  ) then
    raise exception 'marketing campaign location must belong to its studio' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.mkt01_validate_recipient_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.marketing_campaigns where id = new.campaign_id and studio_id = new.studio_id
  ) then
    raise exception 'marketing recipient campaign must belong to its studio' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.salon_customers where id = new.salon_customer_id and studio_id = new.studio_id
  ) then
    raise exception 'marketing recipient customer must belong to its studio' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mkt01_campaign_scope_trg
  before insert or update of studio_id, location_id on public.marketing_campaigns
  for each row execute function public.mkt01_validate_campaign_scope();

create trigger mkt01_recipient_scope_trg
  before insert or update of studio_id, campaign_id, salon_customer_id on public.marketing_campaign_recipients
  for each row execute function public.mkt01_validate_recipient_scope();

revoke all on function public.mkt01_validate_campaign_scope(), public.mkt01_validate_recipient_scope()
  from public, anon, authenticated;
grant execute on function public.mkt01_validate_campaign_scope(), public.mkt01_validate_recipient_scope() to service_role;
