-- Allow booking payment_status values used by expire_pending_payments /
-- cancel_pending_payment (failed / expired).
-- Previously CHECK only allowed pending | paid, so manual updates and RPCs violated 23514.

alter table public.bookings
  drop constraint if exists bookings_payment_status_check;

alter table public.bookings
  add constraint bookings_payment_status_check
  check (
    payment_status = any (
      array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text]
    )
  );

alter table public.event_bookings
  drop constraint if exists event_bookings_payment_status_check;

alter table public.event_bookings
  add constraint event_bookings_payment_status_check
  check (
    payment_status = any (
      array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text]
    )
  );
