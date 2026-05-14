-- Session venue: free-form address (same pattern as events).
alter table public.class_sessions
add column if not exists address text,
add column if not exists address_details text;
