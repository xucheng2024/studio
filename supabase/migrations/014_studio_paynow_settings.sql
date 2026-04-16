-- Per-studio PayNow configuration + payment snapshot fields

alter table public.studios
  add column if not exists paynow_proxy_type text,
  add column if not exists paynow_uen text,
  add column if not exists paynow_mobile text,
  add column if not exists paynow_payee_name text,
  add column if not exists paynow_enabled boolean not null default false,
  add column if not exists paynow_qr_image_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'studios_paynow_proxy_type_check'
  ) then
    alter table public.studios
      add constraint studios_paynow_proxy_type_check
      check (
        paynow_proxy_type is null
        or paynow_proxy_type in ('uen', 'mobile', 'uen_mobile')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'studios_paynow_enabled_has_proxy_check'
  ) then
    alter table public.studios
      add constraint studios_paynow_enabled_has_proxy_check
      check (
        not paynow_enabled
        or paynow_uen is not null
        or paynow_mobile is not null
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'studios_paynow_proxy_required_fields_check'
  ) then
    alter table public.studios
      add constraint studios_paynow_proxy_required_fields_check
      check (
        paynow_proxy_type is null
        or (
          paynow_proxy_type = 'uen'
          and paynow_uen is not null
        )
        or (
          paynow_proxy_type = 'mobile'
          and paynow_mobile is not null
        )
        or (
          paynow_proxy_type = 'uen_mobile'
          and paynow_uen is not null
          and paynow_mobile is not null
        )
      );
  end if;
end $$;

alter table public.payments
  add column if not exists paynow_proxy_type_snapshot text,
  add column if not exists paynow_uen_snapshot text,
  add column if not exists paynow_mobile_snapshot text,
  add column if not exists paynow_payee_name_snapshot text;
