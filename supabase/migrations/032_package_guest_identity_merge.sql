-- Guest identity support for package purchases (no booking_id path).

alter table public.payments
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text;

create index if not exists idx_payments_guest_email_lower
  on public.payments (lower(trim(guest_email)))
  where guest_email is not null and client_id is null;

create or replace function public.merge_guest_records_for_user(
  p_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_bookings_count int := 0;
  v_payments_count int := 0;
begin
  if p_user_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  update public.bookings b
  set client_id = p_user_id
  where b.client_id is null
    and b.guest_email is not null
    and lower(trim(b.guest_email)) = v_email;
  get diagnostics v_bookings_count = row_count;

  update public.payments p
  set client_id = p_user_id
  where p.client_id is null
    and (
      (p.booking_id is not null and exists (
        select 1
        from public.bookings b
        where b.id = p.booking_id and lower(trim(coalesce(b.guest_email, ''))) = v_email
      ))
      or lower(trim(coalesce(p.guest_email, ''))) = v_email
    );
  get diagnostics v_payments_count = row_count;

  insert into public.guest_merge_audits (user_id, email, merged_bookings, merged_payments)
  values (p_user_id, v_email, v_bookings_count, v_payments_count);

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'merged_bookings', v_bookings_count,
    'merged_payments', v_payments_count
  );
end;
$$;

