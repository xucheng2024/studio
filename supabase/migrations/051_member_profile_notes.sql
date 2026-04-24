alter table public.user_profiles
  add column if not exists notes text;
