-- PayNow MVP flow: pending booking + pending payment + manual/owner confirmation + expiry

alter table public.payments
  add column if not exists booking_id uuid references public.bookings (id) on delete set null,
  add column if not exists package_id uuid references public.packages (id) on delete set null,
  add column if not exists currency text not null default 'SGD',
  add column if not exists payment_method text not null default 'paynow',
  add column if not exists reference_code text,
  add column if not exists qr_payload text,
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz;

alter table public.payments
  alter column client_id drop not null;

alter table public.payments
  drop constraint if exists payments_status_check;

alter table public.payments
  add constraint payments_status_check check (status in ('pending', 'paid', 'failed', 'expired'));

create unique index if not exists idx_payments_reference_code_unique
  on public.payments (reference_code)
  where reference_code is not null;

alter table public.bookings
  add column if not exists payment_status text not null default 'pending';

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check check (status in ('pending', 'booked', 'cancelled', 'attended'));

alter table public.bookings
  drop constraint if exists bookings_payment_status_check;

alter table public.bookings
  add constraint bookings_payment_status_check check (payment_status in ('pending', 'paid'));

create or replace function public.confirm_paynow_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  s public.class_sessions%rowtype;
  pkg public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id uuid;
begin
  select * into p
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'booking_id', p.booking_id);
  end if;

  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  if p.expires_at is not null and p.expires_at < now() then
    update public.payments
      set status = 'expired'
    where id = p.id;
    if p.booking_id is not null then
      update public.bookings
        set status = 'cancelled',
            payment_status = 'pending'
      where id = p.booking_id and status = 'pending';
    end if;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    select * into s from public.class_sessions where id = b.session_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'session_not_found');
    end if;

    if s.spots_left <= 0 then
      return jsonb_build_object('ok', false, 'error', 'session_full');
    end if;

    update public.class_sessions
      set spots_left = spots_left - 1
    where id = s.id;

    update public.bookings
      set status = 'booked',
          payment_status = 'paid'
    where id = b.id;
  end if;

  if p.package_id is not null and p.client_id is not null then
    select * into pkg from public.packages where id = p.package_id;
    if found then
      v_expiry :=
        case
          when pkg.expiry_days is null then null
          else now() + make_interval(days => pkg.expiry_days)
        end;

      insert into public.client_packages (
        client_id,
        package_id,
        credits_left,
        expiry_date
      )
      values (
        p.client_id,
        p.package_id,
        pkg.credits,
        v_expiry
      )
      returning id into v_cp_id;
    end if;
  end if;

  update public.payments
    set status = 'paid',
        paid_at = now()
  where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p.booking_id,
    'client_package_id', v_cp_id
  );
end;
$$;

create or replace function public.expire_pending_payments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id
    from public.payments
    where status = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments
      set status = 'expired'
    where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled',
            payment_status = 'pending'
      where id = r.booking_id
        and status = 'pending';
    end if;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;

grant execute on function public.confirm_paynow_payment(uuid) to service_role;
grant execute on function public.expire_pending_payments() to service_role;
