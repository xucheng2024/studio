alter table public.studios
add column if not exists public_brand_name text,
add column if not exists public_logo_url text;
