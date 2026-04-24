-- Remove legacy PayNow-only columns and rename RPCs to payment-generic names.

alter table public.studios
  drop constraint if exists studios_paynow_proxy_type_check,
  drop constraint if exists studios_paynow_enabled_has_proxy_check,
  drop constraint if exists studios_paynow_proxy_required_fields_check;

alter table public.studios
  drop column if exists paynow_proxy_type,
  drop column if exists paynow_uen,
  drop column if exists paynow_mobile,
  drop column if exists paynow_payee_name,
  drop column if exists paynow_enabled,
  drop column if exists paynow_qr_image_url;

alter table public.payments
  drop column if exists qr_payload,
  drop column if exists paynow_proxy_type_snapshot,
  drop column if exists paynow_uen_snapshot,
  drop column if exists paynow_mobile_snapshot,
  drop column if exists paynow_payee_name_snapshot;

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'confirm_paynow_payment'
  ) then
    alter function public.confirm_paynow_payment(uuid) rename to confirm_payment;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'confirm_paynow_payment_with_invoice'
  ) then
    alter function public.confirm_paynow_payment_with_invoice(uuid, uuid) rename to confirm_payment_with_invoice;
  end if;
end $$;

grant execute on function public.confirm_payment(uuid) to service_role;
grant execute on function public.confirm_payment_with_invoice(uuid, uuid) to service_role;
