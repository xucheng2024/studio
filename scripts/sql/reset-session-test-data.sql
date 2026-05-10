-- Reset ONE class session for QA / demo (bookings + payments + spots_left).
--
-- Edit exactly ONE uuid below (CTE `target`), then run the whole file in Supabase SQL Editor.
--
-- Requires migrations through 077 (reconcile_class_session_spots) and 079 (booking payment_status).
--
-- WARNING: Cancels all bookings on that session; pending payments → expired, paid → refunded.

with target as (
  select '074c53bd-e660-482f-975b-aeefda12c901'::uuid as session_id -- ◄◄◄ change only here
),
u1 as (
  update public.bookings b
  set
    status = 'cancelled',
    payment_status = 'expired',
    cancel_reason = coalesce(b.cancel_reason, 'test_session_reset')
  from target t
  where b.session_id = t.session_id
  returning b.id
),
u2 as (
  update public.payments p
  set status = case
    when p.status = 'paid' then 'refunded'::text
    when p.status = 'pending' then 'expired'::text
    else p.status
  end
  from target t
  where p.id in (
    select b.payment_id
    from public.bookings b
    where b.session_id = t.session_id
      and b.payment_id is not null
  )
  returning p.id
),
u3 as (
  update public.class_sessions cs
  set spots_left = cs.capacity
  from target t
  where cs.id = t.session_id
  returning cs.id
)
select public.reconcile_class_session_spots((select session_id from target));
