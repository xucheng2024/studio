-- customer_confirmed_at and customer_confirmation_note are no longer populated.
-- The self-confirmation step was removed from the customer flow in favour of
-- staff-only verification via confirm_paynow_payment_with_invoice().
-- Columns are retained for historical data but will always be NULL on new rows.
comment on column public.payments.customer_confirmed_at
  is 'deprecated – no longer set; payments are confirmed by staff or auto-match only';

comment on column public.payments.customer_confirmation_note
  is 'deprecated – no longer set';
