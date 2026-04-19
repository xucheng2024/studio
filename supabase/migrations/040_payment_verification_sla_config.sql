alter table public.booking_rules
  add column if not exists payment_verification_sla_min int not null default 30;

alter table public.booking_rules
  drop constraint if exists booking_rules_payment_verification_sla_min_check;

alter table public.booking_rules
  add constraint booking_rules_payment_verification_sla_min_check
  check (payment_verification_sla_min >= 1 and payment_verification_sla_min <= 1440);

comment on column public.booking_rules.payment_verification_sla_min
  is 'Minutes allowed before a pending payment is flagged overdue for staff verification';

