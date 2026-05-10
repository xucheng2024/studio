-- Reset ONE class session for QA / demo (bookings + payments + spots_left).
--
-- 1. Replace the session UUID in ONE place: v_session below (DO block).
-- 2. Run in Supabase SQL Editor (postgres).
-- 3. Optional after:
--      select public.expire_pending_payments();
--
-- WARNING: Cancels all bookings on that session and expires/refunds linked payments.
--          Use only for test / staging data.

do $$
declare
  v_session uuid := '074c53bd-e660-482f-975b-aeefda12c901'; -- ◄◄◄ change here
begin
  update public.bookings b
  set
    status = 'cancelled',
    payment_status = 'expired',
    cancel_reason = coalesce(b.cancel_reason, 'test_session_reset')
  where b.session_id = v_session;

  update public.payments p
  set status = case
    when p.status = 'paid' then 'refunded'::text
    when p.status = 'pending' then 'expired'::text
    else p.status
  end
  where p.id in (
    select b.payment_id
    from public.bookings b
    where b.session_id = v_session
      and b.payment_id is not null
  );

  update public.class_sessions cs
  set spots_left = cs.capacity
  where cs.id = v_session;
end $$;

select public.reconcile_class_session_spots('074c53bd-e660-482f-975b-aeefda12c901'::uuid);
