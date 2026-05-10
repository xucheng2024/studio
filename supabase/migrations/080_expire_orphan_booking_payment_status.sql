-- payments.status CHECK allows: pending, paid, failed, expired, refunded (not 'cancelled').
-- Orphan booking cleanup should match terminal payment states; include refunded for edge cases.

create or replace function public.expire_pending_payments()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id, event_booking_id
    from public.payments p
    where p.status = 'pending'
      and (
        (p.expires_at is not null and p.expires_at < now())
        or (
          p.expires_at is null
          and p.created_at < now() - interval '2 hours'
        )
        or (
          coalesce(p.source, '') in ('online_booking', 'event_booking')
          and p.created_at < now() - interval '15 minutes'
        )
        or (
          coalesce(p.source, '') in ('package_buy', 'member_zone_purchase')
          and p.created_at < now() - interval '30 minutes'
        )
      )
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  for r in
    select b.id as booking_id, b.session_id
    from public.bookings b
    join public.payments p on p.id = b.payment_id
    where b.status = 'pending'
      and p.status in ('failed', 'expired', 'refunded')
    for update of b
  loop
    update public.bookings
      set status = 'cancelled', payment_status = 'expired'
    where id = r.booking_id and status = 'pending';

    if found then
      update public.class_sessions
        set spots_left = spots_left + 1
      where id = r.session_id;

      updated_count := updated_count + 1;
    end if;
  end loop;

  return updated_count;
end;
$$;
