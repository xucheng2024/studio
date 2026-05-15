-- Preserve the original buyer identity on gift payments.
-- When a gift is confirmed, payments.client_id is reassigned to the recipient.
-- buyer_client_id retains the original payer so refund emails reach the right person.

alter table public.payments
  add column if not exists buyer_client_id uuid references public.users(id) on delete set null;

-- Back-fill: for gift payments already confirmed, client_id is now the recipient.
-- We cannot recover the original buyer from the existing data, so leave NULL for
-- historical rows. New rows will be populated by application code going forward.

-- Index for refund email lookups.
create index if not exists payments_buyer_client_id_idx on public.payments (buyer_client_id)
  where buyer_client_id is not null;
