alter table public.classes
add column if not exists deleted_at timestamptz;
