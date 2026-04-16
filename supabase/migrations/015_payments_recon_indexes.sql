-- Operations/Payments performance and recon status alignment

alter table public.payments
  drop constraint if exists payments_recon_status_check;

alter table public.payments
  add constraint payments_recon_status_check
  check (recon_status in ('awaiting_verification', 'matched', 'mismatch', 'needs_review', 'manual_review'));

create index if not exists idx_payments_studio_status_created_desc
  on public.payments (studio_id, status, created_at desc);

create index if not exists idx_payments_studio_recon_verified
  on public.payments (studio_id, recon_status, verified_at);

create index if not exists idx_payments_studio_booking
  on public.payments (studio_id, booking_id);

create index if not exists idx_bookings_session_status
  on public.bookings (session_id, status);
