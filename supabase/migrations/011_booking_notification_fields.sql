alter table public.bookings
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists outcome_notified_at timestamptz;
