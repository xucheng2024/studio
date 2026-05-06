alter table public.packages
add column if not exists deleted_at timestamptz;
