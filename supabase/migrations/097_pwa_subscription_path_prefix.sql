alter table public.pwa_push_subscriptions
  add column if not exists path_prefix text;
