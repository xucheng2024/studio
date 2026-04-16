-- P0: book_session must only consume credits / single-use payments for the session's studio

create or replace function public.book_session(p_session_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.class_sessions%rowtype;
  v_studio_id uuid;
  cp_rec public.client_packages%rowtype;
  pay_rec public.payments%rowtype;
  new_booking_id uuid;
begin
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  select c.studio_id into v_studio_id
  from public.classes c
  where c.id = s.class_id;

  if v_studio_id is null then
    return jsonb_build_object('ok', false, 'error', 'class_not_found');
  end if;

  if exists (
    select 1 from public.bookings
    where session_id = p_session_id and client_id = p_client_id and status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_booked');
  end if;

  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  select cp.*
  into cp_rec
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.client_id = p_client_id
    and pkg.studio_id = v_studio_id
    and cp.credits_left > 0
    and (cp.expiry_date is null or cp.expiry_date > now())
  order by pkg.is_drop_in asc, cp.expiry_date asc nulls last, cp.created_at asc
  limit 1
  for update of cp;

  if found then
    update public.client_packages
      set credits_left = credits_left - 1
    where id = cp_rec.id;

    insert into public.bookings (session_id, client_id, status, client_package_id)
    values (p_session_id, p_client_id, 'booked', cp_rec.id)
    returning id into new_booking_id;

    update public.class_sessions
      set spots_left = spots_left - 1
    where id = p_session_id;

    return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'package');
  end if;

  select p.*
  into pay_rec
  from public.payments p
  where p.client_id = p_client_id
    and p.type = 'single'
    and p.status = 'paid'
    and p.remaining_uses > 0
    and p.studio_id = v_studio_id
  order by p.created_at asc
  limit 1
  for update;

  if found then
    update public.payments
      set remaining_uses = remaining_uses - 1
    where id = pay_rec.id;

    insert into public.bookings (session_id, client_id, status, payment_id)
    values (p_session_id, p_client_id, 'booked', pay_rec.id)
    returning id into new_booking_id;

    update public.class_sessions
      set spots_left = spots_left - 1
    where id = p_session_id;

    return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'single');
  end if;

  return jsonb_build_object('ok', false, 'error', 'no_credits');
end;
$$;
