-- Optional public URL: event detail "Book" opens this link instead of HitPay checkout.
alter table public.events
add column if not exists external_booking_url text;
