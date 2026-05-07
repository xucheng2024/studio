alter table public.customer_subscriptions
add column if not exists billing_start_date date;

