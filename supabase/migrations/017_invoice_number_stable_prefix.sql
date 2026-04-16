-- Keep invoice numbering prefix stable even if studio name changes.
-- Prefix now derives from studio UUID segment rather than studio name.

create or replace function public.assign_payment_invoice_number(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_studio_code text;
  v_ym text;
  v_prefix text;
  v_last_seq int := 0;
  v_invoice text;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.invoice_number is not null then
    return v_payment.invoice_number;
  end if;

  if v_payment.studio_id is null then
    raise exception 'payment_missing_studio';
  end if;

  v_studio_code := upper(substr(replace(v_payment.studio_id::text, '-', ''), 1, 4));
  if v_studio_code is null or v_studio_code = '' then
    v_studio_code := 'STUD';
  end if;

  v_ym := to_char(coalesce(v_payment.verified_at, now()), 'YYYYMM');
  v_prefix := v_studio_code || '_' || v_ym || '_';

  perform pg_advisory_xact_lock(hashtext(v_prefix));

  select coalesce(max(right(invoice_number, 5)::int), 0)
  into v_last_seq
  from public.payments
  where studio_id = v_payment.studio_id
    and invoice_number like v_prefix || '%';

  v_invoice := v_prefix || lpad((v_last_seq + 1)::text, 5, '0');

  update public.payments
  set invoice_number = v_invoice
  where id = p_payment_id;

  return v_invoice;
end;
$$;

grant execute on function public.assign_payment_invoice_number(uuid) to service_role;
