alter table public.customer_subscriptions
add column if not exists current_period_end timestamptz,
add column if not exists cancel_at_period_end boolean not null default false,
add column if not exists cancel_requested_at timestamptz;
