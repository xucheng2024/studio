-- Gift purchases: buyer pays, recipient receives the entitlement.
alter table public.payments
  add column if not exists is_gift boolean not null default false,
  add column if not exists gift_recipient_name text,
  add column if not exists gift_recipient_email text,
  add column if not exists gift_message text;
