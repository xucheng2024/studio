alter table public.client_packages
add column if not exists package_name_snapshot text,
add column if not exists package_credits_snapshot integer,
add column if not exists package_expiry_days_snapshot integer;

alter table public.payments
add column if not exists package_name_snapshot text;

update public.client_packages cp
set
  package_name_snapshot = pkg.name,
  package_credits_snapshot = pkg.credits,
  package_expiry_days_snapshot = pkg.expiry_days
from public.packages pkg
where pkg.id = cp.package_id
  and (
    cp.package_name_snapshot is null
    or cp.package_credits_snapshot is null
    or cp.package_expiry_days_snapshot is distinct from pkg.expiry_days
  );

update public.payments p
set package_name_snapshot = pkg.name
from public.packages pkg
where pkg.id = p.package_id
  and p.package_id is not null
  and p.package_name_snapshot is null;

create or replace function public.confirm_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
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
    update public.payments set status = 'expired' where id = p.id;

    if p.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = p.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = p.booking_id);
      end if;
    end if;

    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    update public.bookings
      set status = 'booked', payment_status = 'paid'
    where id = b.id and status = 'pending';
  end if;

  if p.package_id is not null and p.client_id is not null then
    select * into pkg from public.packages where id = p.package_id;
    if found then
      v_expiry :=
        case
          when pkg.expiry_days is null then null
          else now() + make_interval(days => pkg.expiry_days)
        end;

      insert into public.client_packages
      select
        gen_random_uuid(),
        p.client_id,
        p.package_id,
        pkg.credits,
        v_expiry,
        now(),
        coalesce(p.package_name_snapshot, pkg.name),
        pkg.credits,
        pkg.expiry_days
      returning id into v_cp_id;
    end if;
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p.booking_id,
    'client_package_id', v_cp_id
  );
end;
$$;

create or replace function public.confirm_paynow_payment(p_payment_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  s public.class_sessions%rowtype;
  pkg public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id uuid;
  v_seat_restored boolean := false;
begin
  select * into p from public.payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'booking_id', p.booking_id);
  end if;

  if not p_force then
    if p.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'not_pending');
    end if;

    if p.expires_at is not null and p.expires_at < now() then
      update public.payments set status = 'expired' where id = p.id;

      if p.booking_id is not null then
        update public.bookings
          set status = 'cancelled', payment_status = 'pending'
        where id = p.booking_id and status = 'pending';

        if found then
          update public.class_sessions
            set spots_left = spots_left + 1
          where id = (select session_id from public.bookings where id = p.booking_id);
        end if;
      end if;

      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
  else
    if p.status not in ('pending', 'expired') then
      return jsonb_build_object('ok', false, 'error', 'not_confirmable');
    end if;
  end if;

  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    if b.status = 'pending' then
      update public.bookings
        set status = 'booked', payment_status = 'paid'
      where id = b.id;

    elsif b.status = 'cancelled' and p_force then
      select * into s from public.class_sessions where id = b.session_id for update;
      if found and coalesce(s.spots_left, 0) > 0 then
        update public.class_sessions set spots_left = spots_left - 1 where id = s.id;
        update public.bookings
          set status = 'booked',
              payment_status = 'paid',
              cancelled_at = null,
              cancel_reason = null
        where id = b.id;
        v_seat_restored := true;
      else
        update public.bookings set payment_status = 'paid' where id = b.id;
      end if;
    end if;
  end if;

  if p.package_id is not null and p.client_id is not null then
    if not exists (
      select 1 from public.client_packages cp
      join public.packages pkg2 on pkg2.id = cp.package_id
      where cp.client_id = p.client_id
        and cp.package_id = p.package_id
        and cp.created_at >= p.created_at
    ) then
      select * into pkg from public.packages where id = p.package_id;
      if found then
        v_expiry :=
          case
            when pkg.expiry_days is null then null
            else now() + make_interval(days => pkg.expiry_days)
          end;
        insert into public.client_packages
        select
          gen_random_uuid(),
          p.client_id,
          p.package_id,
          pkg.credits,
          v_expiry,
          now(),
          coalesce(p.package_name_snapshot, pkg.name),
          pkg.credits,
          pkg.expiry_days
        returning id into v_cp_id;
      end if;
    end if;
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p.booking_id,
    'client_package_id', v_cp_id,
    'seat_restored', v_seat_restored
  );
end;
$$;
