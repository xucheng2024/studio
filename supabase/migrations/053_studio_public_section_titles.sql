alter table public.studios
add column if not exists public_services_title text,
add column if not exists public_classes_title text,
add column if not exists public_packages_title text;
