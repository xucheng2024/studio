-- Public service checkout quantity. Default 1 keeps existing orders unchanged.

alter table public.service_orders
  add column if not exists qty integer not null default 1;

alter table public.service_orders
  drop constraint if exists service_orders_qty_positive;

alter table public.service_orders
  add constraint service_orders_qty_positive
  check (qty >= 1);
