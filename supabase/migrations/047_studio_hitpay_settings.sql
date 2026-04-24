-- Per-studio HitPay credentials and enable flag.

alter table public.studios
  add column if not exists hitpay_enabled boolean not null default false,
  add column if not exists hitpay_business_name text,
  add column if not exists hitpay_api_key text,
  add column if not exists hitpay_webhook_salt text;
