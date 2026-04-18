-- One-time backfill: assign invoice_number for payments already marked paid (idempotent).

do $$
declare
  r record;
begin
  for r in
    select id
    from public.payments
    where status = 'paid'
      and invoice_number is null
      and studio_id is not null
    order by studio_id, coalesce(verified_at, created_at, now())
  loop
    perform public.assign_payment_invoice_number(r.id);
  end loop;
end $$;
