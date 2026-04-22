-- Tighten public visibility and data integrity for studio_services.

alter table public.studio_services
  drop constraint if exists studio_services_price_non_negative,
  drop constraint if exists studio_services_currency_format;

alter table public.studio_services
  add constraint studio_services_price_non_negative check (price >= 0),
  add constraint studio_services_currency_format check (currency ~ '^[A-Z]{3}$');

drop policy if exists "studio_services_read_public_active" on public.studio_services;
create policy "studio_services_read_public_active"
  on public.studio_services
  for select
  using (
    is_active = true
    and exists (
      select 1
      from public.studios s
      where s.id = studio_services.studio_id
        and s.contract_status = 'active'
    )
  );
