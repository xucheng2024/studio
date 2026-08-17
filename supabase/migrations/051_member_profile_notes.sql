-- This legacy application dump intentionally excludes pg_dump's `\restrict`
-- directives and the managed auth/storage schema dump. Supabase provisions
-- those schemas; replaying them makes an empty local reset fail before the
-- application schema can be validated.
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assign_payment_invoice_number"("p_payment_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."assign_payment_invoice_number"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_session"("p_session_id" "uuid", "p_client_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."book_session"("p_session_id" "uuid", "p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_session_guest"("p_session_id" "uuid", "p_studio_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  s public.class_sessions%rowtype;
  new_booking_id uuid;
  em text := lower(trim(p_guest_email));
  nm text := trim(p_guest_name);
  ph text := nullif(trim(p_guest_phone), '');
begin
  if em = '' or nm = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_guest');
  end if;

  select cs.*
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
    and c.studio_id = p_studio_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.status = 'booked'
      and b.client_id is null
      and lower(trim(b.guest_email)) = em
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_booked');
  end if;

  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  insert into public.bookings (
    session_id,
    client_id,
    status,
    guest_name,
    guest_email,
    guest_phone
  )
  values (
    p_session_id,
    null,
    'booked',
    nm,
    em,
    ph
  )
  returning id into new_booking_id;

  update public.class_sessions
    set spots_left = spots_left - 1
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'guest');
end;
$$;


ALTER FUNCTION "public"."book_session_guest"("p_session_id" "uuid", "p_studio_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.cancel_booking_with_rules(p_booking_id, auth.uid(), 'legacy_cancel');
end;
$$;


ALTER FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking_with_rules"("p_booking_id" "uuid", "p_actor_id" "uuid", "p_cancel_reason" "text" DEFAULT 'user_cancel'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b              public.bookings%rowtype;
  v_session      record;
  v_rule         record;
  v_is_client    boolean := false;
  v_is_staff     boolean := false;
  v_is_after_cutoff boolean := false;
  v_return_credit boolean := false;
  v_next_status  text;
  v_credits_to_return int := 0;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select cs.id as session_id, cs.start_time, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  v_is_client := b.client_id is not null and b.client_id = p_actor_id;
  v_is_staff  := exists (
    select 1 from public.studios s
    where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1 from public.staff_memberships sm
    where sm.user_id    = p_actor_id
      and sm.studio_id  = v_session.studio_id
      and sm.is_active  = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not (v_is_client or v_is_staff) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if b.status not in ('pending', 'booked') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  select br.cancel_cutoff_hours, br.late_cancel_deduct_credit
  into v_rule
  from public.booking_rules br
  where br.studio_id = v_session.studio_id
    and (br.location_id = b.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  -- Pending (unpaid PayNow) booking: just cancel, no credit involved
  if b.status = 'pending' then
    update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
        credit_policy_applied = jsonb_build_object(
          'policy', 'pending_unpaid_cancel', 'credit_returned', false
        )
    where id = b.id;
    -- Restore spot for pending bookings
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'credit_returned', false);
  end if;

  v_is_after_cutoff := now() >= (
    v_session.start_time - make_interval(hours => coalesce(v_rule.cancel_cutoff_hours, 12))
  );
  v_next_status := case when v_is_after_cutoff then 'late_cancel' else 'cancelled' end;
  v_return_credit := case
    when not v_is_after_cutoff                           then true
    when coalesce(v_rule.late_cancel_deduct_credit, true) then false
    else true
  end;

  if v_next_status = 'cancelled' then
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
  end if;

  -- Return the exact number of credits that were consumed at booking time
  if v_return_credit and b.client_package_id is not null then
    v_credits_to_return := greatest(coalesce(b.credits_consumed, 0), 1);
    update public.client_packages
    set credits_left = credits_left + v_credits_to_return
    where id = b.client_package_id;
  end if;
  if v_return_credit and b.payment_id is not null then
    update public.payments
    set remaining_uses = remaining_uses + 1
    where id = b.payment_id;
  end if;

  update public.bookings
  set status = v_next_status,
      cancelled_at = now(),
      cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
      credit_policy_applied = jsonb_build_object(
        'policy', case when v_next_status = 'late_cancel' then 'late_cancel' else 'normal_cancel' end,
        'cutoff_hours', coalesce(v_rule.cancel_cutoff_hours, 12),
        'after_cutoff', v_is_after_cutoff,
        'credit_returned', v_return_credit,
        'credits_returned', case when v_return_credit then v_credits_to_return else 0 end
      )
  where id = b.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_next_status,
    'credit_returned', v_return_credit
  );
end;
$$;


ALTER FUNCTION "public"."cancel_booking_with_rules"("p_booking_id" "uuid", "p_actor_id" "uuid", "p_cancel_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_pending_payment"("p_payment_id" "uuid", "p_new_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  p public.payments%rowtype;
begin
  if p_new_status not in ('failed', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select * into p from public.payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update public.payments set status = p_new_status where id = p.id;

  if p.booking_id is not null then
    update public.bookings
      set status = 'cancelled', payment_status = p_new_status
    where id = p.booking_id and status = 'pending';

    if found then
      update public.class_sessions
        set spots_left = spots_left + 1
      where id = (select session_id from public.bookings where id = p.booking_id);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."cancel_pending_payment"("p_payment_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_session         record;
  v_booking         record;
  v_pay             record;
  v_reason          text;
  v_refund          jsonb;
  v_affected        int := 0;
  v_credits         int := 0;
  v_refunds         int := 0;
  v_errors          int := 0;
  v_already_cancelled int := 0;
  v_credits_to_return int;
begin
  select cs.*, c.studio_id as class_studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  select count(*)::int
  into v_already_cancelled
  from public.bookings
  where session_id = p_session_id
    and status = 'cancelled_by_studio';

  if v_session.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'session_id', p_session_id,
      'affected_bookings', 0,
      'credits_returned_count', 0,
      'payments_refunded_count', 0,
      'already_cancelled_count', v_already_cancelled,
      'errors_count', 0
    );
  end if;

  if v_session.status <> 'scheduled' then
    return jsonb_build_object(
      'ok', false,
      'error', 'session_not_cancellable',
      'session_status', v_session.status
    );
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Session cancelled by studio');

  for v_booking in
    select * from public.bookings
    where session_id = p_session_id
      and status in ('pending', 'booked')
    for update
  loop
    update public.bookings
    set
      status = 'cancelled_by_studio',
      cancelled_by_studio_at = now(),
      cancelled_by_studio_reason = v_reason
    where id = v_booking.id;

    -- Restore the seat that was reserved at booking-creation time.
    update public.class_sessions
    set spots_left = spots_left + 1
    where id = p_session_id;

    v_affected := v_affected + 1;

    -- Return exactly as many credits as were consumed, not always 1.
    if v_booking.credit_consumed_at is not null then
      v_credits_to_return := greatest(coalesce(v_booking.credits_consumed, 1), 1);

      if v_booking.client_package_id is not null then
        update public.client_packages
        set credits_left = credits_left + v_credits_to_return
        where id = v_booking.client_package_id;
        v_credits := v_credits + v_credits_to_return;
      elsif v_booking.payment_id is not null then
        update public.payments
        set remaining_uses = coalesce(remaining_uses, 0) + v_credits_to_return
        where id = v_booking.payment_id;
        v_credits := v_credits + v_credits_to_return;
      end if;
    end if;

    -- Refund any confirmed PayNow payment attached to this booking.
    for v_pay in
      select id from public.payments
      where booking_id = v_booking.id
        and status = 'paid'
    loop
      v_refund := public.refund_payment_with_invoice_void(
        v_pay.id,
        p_actor_id,
        coalesce(nullif(trim(p_reason), ''), 'session_cancelled')
      );
      if coalesce((v_refund->>'ok')::boolean, false) is not true then
        v_errors := v_errors + 1;
        raise exception 'refund_failed payment %: %', v_pay.id, coalesce(v_refund->>'error', 'unknown');
      end if;
      if coalesce((v_refund->>'already_refunded')::boolean, false) = false then
        v_refunds := v_refunds + 1;
      end if;
    end loop;
  end loop;

  update public.class_sessions
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = v_reason,
    cancelled_by = p_actor_id
  where id = p_session_id;

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_actor_id,
    'staff',
    'session_cancel_settlement',
    'class_session',
    p_session_id,
    jsonb_build_object('status', 'scheduled'),
    jsonb_build_object(
      'status', 'cancelled',
      'affected_bookings', v_affected,
      'credits_returned_count', v_credits,
      'payments_refunded_count', v_refunds,
      'already_cancelled_count', v_already_cancelled,
      'errors_count', v_errors,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'session_id', p_session_id,
    'affected_bookings', v_affected,
    'credits_returned_count', v_credits,
    'payments_refunded_count', v_refunds,
    'already_cancelled_count', v_already_cancelled,
    'errors_count', v_errors
  );
end;
$$;


ALTER FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkin_booking"("p_booking_id" "uuid", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b public.bookings%rowtype;
  v_session record;
  v_authorized boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_booked');
  end if;

  select
    cs.id as session_id,
    c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id;

  v_authorized := exists (
    select 1 from public.studios s where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_session.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk', 'instructor')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.bookings
    set status = 'attended',
        checked_in_at = now(),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
          jsonb_build_object('checkin_by', p_actor_id::text, 'checkin_at', now())
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."checkin_booking"("p_booking_id" "uuid", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_payment"("p_payment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  p   public.payments%rowtype;
  b   public.bookings%rowtype;
  pkg public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id  uuid;
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

  -- Payment has already expired: clean up and restore the reserved seat.
  if p.expires_at is not null and p.expires_at < now() then
    update public.payments set status = 'expired' where id = p.id;

    if p.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = p.booking_id and status = 'pending';

      -- Restore the seat that was reserved at booking-creation time.
      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = p.booking_id);
      end if;
    end if;

    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- Confirm the booking: seat was already claimed in create_pending_booking,
  -- so we only need to flip the status — no spots_left change here.
  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    update public.bookings
      set status = 'booked', payment_status = 'paid'
    where id = b.id and status = 'pending';
  end if;

  -- Grant package credits when this payment covers a package purchase.
  if p.package_id is not null and p.client_id is not null then
    select * into pkg from public.packages where id = p.package_id;
    if found then
      v_expiry :=
        case
          when pkg.expiry_days is null then null
          else now() + make_interval(days => pkg.expiry_days)
        end;

      insert into public.client_packages (client_id, package_id, credits_left, expiry_date)
      values (p.client_id, p.package_id, pkg.credits, v_expiry)
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


ALTER FUNCTION "public"."confirm_payment"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_confirm jsonb;
  v_ok      boolean;
  v_error   text;
  v_invoice text;
begin
  v_confirm := public.confirm_paynow_payment(p_payment_id, true);
  v_ok := coalesce((v_confirm ->> 'ok')::boolean, false);
  if not v_ok then
    v_error := coalesce(v_confirm ->> 'error', 'confirm_failed');
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  select public.assign_payment_invoice_number(p_payment_id) into v_invoice;
  if v_invoice is null or btrim(v_invoice) = '' then
    return jsonb_build_object('ok', false, 'error', 'invoice_assign_failed');
  end if;

  update public.payments
  set verified_at = now(), verified_by = p_verified_by
  where id = p_payment_id;

  return jsonb_build_object(
    'ok', true,
    'invoice_number', v_invoice,
    'already_paid',      coalesce((v_confirm ->> 'already_paid')::boolean, false),
    'booking_id',        v_confirm ->> 'booking_id',
    'client_package_id', v_confirm ->> 'client_package_id',
    'seat_restored',     coalesce((v_confirm ->> 'seat_restored')::boolean, false)
  );
end;
$$;


ALTER FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_paynow_payment"("p_payment_id" "uuid", "p_force" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  p        public.payments%rowtype;
  b        public.bookings%rowtype;
  s        public.class_sessions%rowtype;
  pkg      public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id  uuid;
  v_seat_restored boolean := false;
begin
  select * into p from public.payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  -- Already confirmed — idempotent.
  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'booking_id', p.booking_id);
  end if;

  -- ── Normal (non-forced) path ─────────────────────────────────────────────
  if not p_force then
    if p.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'not_pending');
    end if;

    -- Expiry guard: auto-cancel booking and restore the seat.
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

  -- ── Forced (staff override) path ─────────────────────────────────────────
  else
    -- Accept 'pending' and 'expired'; anything else (failed, refunded…) is a no-op.
    if p.status not in ('pending', 'expired') then
      return jsonb_build_object('ok', false, 'error', 'not_confirmable');
    end if;
  end if;

  -- ── Confirm the booking ──────────────────────────────────────────────────
  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    if b.status = 'pending' then
      -- Normal case: booking is still pending — just flip it.
      update public.bookings
        set status = 'booked', payment_status = 'paid'
      where id = b.id;

    elsif b.status = 'cancelled' and p_force then
      -- Payment expired and cron already cancelled the booking.
      -- Try to reclaim a seat if one is still available.
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
        -- No seats left — reinstate payment but leave booking cancelled.
        -- Staff will need to handle the rebooking manually.
        update public.bookings set payment_status = 'paid' where id = b.id;
      end if;
    end if;
  end if;

  -- ── Grant package credits ────────────────────────────────────────────────
  if p.package_id is not null and p.client_id is not null then
    -- Only insert a new client_package if none exists yet for this payment.
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
        insert into public.client_packages (client_id, package_id, credits_left, expiry_date)
        values (p.client_id, p.package_id, pkg.credits, v_expiry)
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


ALTER FUNCTION "public"."confirm_paynow_payment"("p_payment_id" "uuid", "p_force" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_booking_credit_once"("p_booking_id" "uuid", "p_reason" "text" DEFAULT 'checkin'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  b public.bookings%rowtype;
  cp public.client_packages%rowtype;
  pay public.payments%rowtype;
  v_credits_required int := 1;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'consumed', false, 'source', null, 'error', 'booking_not_found');
  end if;
  if b.credit_consumed_at is not null then
    return jsonb_build_object('ok', true, 'consumed', true, 'source', b.credit_consumption_source, 'error', null);
  end if;

  select coalesce(cs.credits_required, 1)
  into v_credits_required
  from public.class_sessions cs
  where cs.id = b.session_id;

  if b.client_package_id is not null then
    select * into cp from public.client_packages where id = b.client_package_id for update;
    if found and (cp.expiry_date is null or cp.expiry_date > now()) then
      if cp.credits_left < v_credits_required then
        return jsonb_build_object('ok', false, 'consumed', false, 'source', 'package', 'error', 'insufficient_credits');
      end if;
      update public.client_packages set credits_left = credits_left - v_credits_required where id = cp.id;
      update public.bookings
        set credit_consumed_at = now(),
            credit_consumption_source = 'package',
            credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
              jsonb_build_object('credit_consumed_reason', p_reason, 'credit_source', 'package', 'credits_required', v_credits_required)
      where id = b.id;
      return jsonb_build_object('ok', true, 'consumed', true, 'source', 'package', 'credits_required', v_credits_required, 'error', null);
    end if;
    return jsonb_build_object('ok', false, 'consumed', false, 'source', 'package', 'error', 'no_credit_source');
  end if;

  if b.payment_id is not null then
    select * into pay from public.payments where id = b.payment_id for update;
    if found and coalesce(pay.remaining_uses, 0) > 0 then
      update public.payments set remaining_uses = remaining_uses - 1 where id = pay.id;
      update public.bookings
        set credit_consumed_at = now(),
            credit_consumption_source = 'single',
            credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
              jsonb_build_object('credit_consumed_reason', p_reason, 'credit_source', 'single')
      where id = b.id;
      return jsonb_build_object('ok', true, 'consumed', true, 'source', 'single', 'credits_required', 1, 'error', null);
    end if;
    return jsonb_build_object('ok', false, 'consumed', false, 'source', 'single', 'error', 'no_credit_source');
  end if;

  return jsonb_build_object('ok', true, 'consumed', false, 'source', 'none', 'error', null);
end;
$$;


ALTER FUNCTION "public"."consume_booking_credit_once"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_member_booking_auto"("p_session_id" "uuid", "p_client_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  s                    record;
  v_rule               record;
  v_active_count       int := 0;
  v_weekly_late        int := 0;
  v_booking_id         uuid;
  v_selected_package_id uuid;
  v_has_candidate      boolean;
  v_has_enough         boolean;
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.credits_required, c.studio_id
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  select br.max_active_bookings_per_client, br.max_weekly_late_cancel
  into v_rule
  from public.booking_rules br
  where br.studio_id = s.studio_id
    and (br.location_id = s.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  select count(*)::int into v_active_count
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('pending', 'booked')
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_active_count >= coalesce(v_rule.max_active_bookings_per_client, 3) then
    return jsonb_build_object('ok', false, 'error', 'active_booking_limit_exceeded');
  end if;

  select count(*)::int into v_weekly_late
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('late_cancel', 'no_show')
    and b.created_at >= now() - interval '7 days'
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
    return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
  end if;

  -- Check a candidate package exists (correct studio + location + not expired)
  select exists (
    select 1
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    where cp.client_id   = p_client_id
      and pkg.studio_id  = s.studio_id
      and (pkg.location_id is null or pkg.location_id = s.location_id)
      and (cp.expiry_date is null or cp.expiry_date > now())
  ) into v_has_candidate;
  if not v_has_candidate then
    return jsonb_build_object('ok', false, 'error', 'no_eligible_package');
  end if;

  -- Check sufficient credits exist
  select exists (
    select 1
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    where cp.client_id    = p_client_id
      and pkg.studio_id   = s.studio_id
      and (pkg.location_id is null or pkg.location_id = s.location_id)
      and (cp.expiry_date is null or cp.expiry_date > now())
      and cp.credits_left >= s.credits_required
  ) into v_has_enough;
  if not v_has_enough then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  -- Select best package (FEFO)
  select cp.id into v_selected_package_id
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.client_id    = p_client_id
    and pkg.studio_id   = s.studio_id
    and (pkg.location_id is null or pkg.location_id = s.location_id)
    and (cp.expiry_date is null or cp.expiry_date > now())
    and cp.credits_left >= s.credits_required
  order by cp.expiry_date asc nulls last, cp.created_at asc, cp.id asc
  for update of cp
  limit 1;

  if v_selected_package_id is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  -- Create booking
  insert into public.bookings (
    session_id, location_id, client_id,
    status, payment_status, client_package_id,
    credits_consumed, credit_consumed_at, credit_consumption_source,
    credit_policy_applied
  ) values (
    p_session_id, s.location_id, p_client_id,
    'booked', 'paid', v_selected_package_id,
    s.credits_required, now(), 'package',
    jsonb_build_object('credit_deducted_at', 'booking', 'credits_required', s.credits_required)
  ) returning id into v_booking_id;

  -- Decrement credits immediately (prevents double-booking the same credit pool)
  update public.client_packages
  set credits_left = credits_left - s.credits_required
  where id = v_selected_package_id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'selected_package_id', v_selected_package_id,
    'credits_required', s.credits_required
  );
end;
$$;


ALTER FUNCTION "public"."create_member_booking_auto"("p_session_id" "uuid", "p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  s             record;
  cp            record;
  v_rule        record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.credits_required, c.studio_id
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  select cp.id, cp.client_id, cp.credits_left, cp.expiry_date,
         pkg.id as package_id, pkg.studio_id, pkg.location_id
  into cp
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.id        = p_client_package_id
    and cp.client_id = p_client_id
  for update of cp;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'package_not_found');
  end if;
  if cp.studio_id <> s.studio_id then
    return jsonb_build_object('ok', false, 'error', 'studio_mismatch');
  end if;
  if cp.location_id is not null and cp.location_id <> s.location_id then
    return jsonb_build_object('ok', false, 'error', 'location_mismatch');
  end if;
  if cp.expiry_date is not null and cp.expiry_date <= now() then
    return jsonb_build_object('ok', false, 'error', 'package_expired');
  end if;
  if cp.credits_left < s.credits_required then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  select br.max_active_bookings_per_client, br.max_weekly_late_cancel
  into v_rule
  from public.booking_rules br
  where br.studio_id = s.studio_id
    and (br.location_id = s.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  select count(*)::int into v_active_count
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('pending', 'booked')
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_active_count >= coalesce(v_rule.max_active_bookings_per_client, 3) then
    return jsonb_build_object('ok', false, 'error', 'active_booking_limit_exceeded');
  end if;

  select count(*)::int into v_weekly_late
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('late_cancel', 'no_show')
    and b.created_at >= now() - interval '7 days'
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
    return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
  end if;

  insert into public.bookings (
    session_id, location_id, client_id,
    status, payment_status, client_package_id,
    credits_consumed, credit_consumed_at, credit_consumption_source,
    credit_policy_applied
  ) values (
    p_session_id, s.location_id, p_client_id,
    'booked', 'paid', p_client_package_id,
    s.credits_required, now(), 'package',
    jsonb_build_object('credit_deducted_at', 'booking', 'credits_required', s.credits_required)
  ) returning id into v_booking_id;

  -- Deduct credits immediately
  update public.client_packages
  set credits_left = credits_left - s.credits_required
  where id = cp.id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;


ALTER FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") IS 'Manual package override only. Prefer create_member_booking_auto for standard member booking.';



CREATE OR REPLACE FUNCTION "public"."create_pending_booking"("p_session_id" "uuid", "p_client_id" "uuid" DEFAULT NULL::"uuid", "p_guest_name" "text" DEFAULT NULL::"text", "p_guest_email" "text" DEFAULT NULL::"text", "p_guest_phone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_session     record;
  v_rule        record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
  v_guest_email  text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.guest_price, cs.credits_required, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(v_session.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if v_session.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null and exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1 from public.bookings b
    where b.session_id  = p_session_id
      and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is not null then
    select br.max_active_bookings_per_client, br.max_weekly_late_cancel
    into v_rule
    from public.booking_rules br
    where br.studio_id = v_session.studio_id
      and (br.location_id = v_session.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    select count(*)::int into v_active_count
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.client_id = p_client_id
      and b.status in ('pending', 'booked')
      and c.studio_id = v_session.studio_id
      and (v_session.location_id is null or b.location_id = v_session.location_id);
    if v_active_count >= coalesce(v_rule.max_active_bookings_per_client, 3) then
      return jsonb_build_object('ok', false, 'error', 'active_booking_limit_exceeded');
    end if;

    select count(*)::int into v_weekly_late
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.client_id = p_client_id
      and b.status in ('late_cancel', 'no_show')
      and b.created_at >= now() - interval '7 days'
      and c.studio_id = v_session.studio_id
      and (v_session.location_id is null or b.location_id = v_session.location_id);
    if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
      return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
    end if;
  end if;

  -- Atomically claim one seat. The FOR UPDATE lock above guarantees that
  -- concurrent callers see an up-to-date spots_left and only one of them
  -- can decrement it from 1 → 0, preventing overselling.
  update public.class_sessions
  set spots_left = spots_left - 1
  where id = p_session_id;

  insert into public.bookings (
    session_id, location_id, client_id,
    guest_name, guest_email, guest_phone,
    status, payment_status
  ) values (
    p_session_id, v_session.location_id, p_client_id,
    case when p_client_id is null then nullif(trim(p_guest_name), '') else null end,
    case when p_client_id is null then v_guest_email else null end,
    case when p_client_id is null then nullif(trim(coalesce(p_guest_phone, '')), '') else null end,
    'pending', 'pending'
  ) returning id into v_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'studio_id', v_session.studio_id,
    'location_id', v_session.location_id
  );
end;
$$;


ALTER FUNCTION "public"."create_pending_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_total int;
  v_after_suspended int;
begin
  if p_owner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_owner');
  end if;

  insert into public.platform_owner_grants (user_id, is_active, created_at)
  values (p_owner_user_id, false, now())
  on conflict (user_id)
  do update set is_active = excluded.is_active;

  select count(*)::int into v_total from public.studios where owner_id = p_owner_user_id;

  update public.studios
  set contract_status = 'suspended'
  where owner_id = p_owner_user_id;

  select count(*)::int into v_after_suspended
  from public.studios
  where owner_id = p_owner_user_id
    and contract_status = 'suspended';

  return jsonb_build_object(
    'ok', true,
    'owner_user_id', p_owner_user_id,
    'studio_count', coalesce(v_total, 0),
    'studios_suspended_total', coalesce(v_after_suspended, 0)
  );
end;
$$;


ALTER FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_pending_payments"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r             record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id
    from public.payments
    where status     = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      -- Cancel the booking only if it is still pending (not yet confirmed/cancelled).
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = r.booking_id and status = 'pending';

      -- Restore the seat reserved by create_pending_booking.
      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;


ALTER FUNCTION "public"."expire_pending_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.users (id, email)
  values (
    new.id,
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_guest_merge"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.merge_guest_records_for_user(new.id, new.email);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_user_guest_merge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_guest_records_for_user"("p_user_id" "uuid", "p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."merge_guest_records_for_user"("p_user_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_no_show_bookings"("p_limit" integer DEFAULT 500) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  v_rule record;
  v_count int := 0;
  v_buffer int;
begin
  for r in
    select b.id, b.location_id, b.client_package_id, b.payment_id, b.credit_consumed_at, c.studio_id, cs.start_time, cs.credits_required
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.status = 'booked' and b.checked_in_at is null
    order by cs.start_time
    limit greatest(coalesce(p_limit, 500), 1)
    for update of b skip locked
  loop
    select br.no_show_deduct_credit, br.no_show_buffer_min
    into v_rule
    from public.booking_rules br
    where br.studio_id = r.studio_id and (br.location_id = r.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    v_buffer := greatest(coalesce(v_rule.no_show_buffer_min, 15), 0);
    if now() < (r.start_time + make_interval(mins => v_buffer)) then
      continue;
    end if;

    if coalesce(v_rule.no_show_deduct_credit, true) then
      perform public.consume_booking_credit_once(r.id, 'no_show');
    elsif r.credit_consumed_at is not null then
      if r.client_package_id is not null then
        update public.client_packages
          set credits_left = credits_left + coalesce(r.credits_required, 1)
        where id = r.client_package_id;
      elsif r.payment_id is not null then
        update public.payments
          set remaining_uses = remaining_uses + 1
        where id = r.payment_id;
      end if;
    end if;

    update public.bookings
      set status = 'no_show',
          no_show_marked_at = now(),
          credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) || jsonb_build_object(
            'policy', 'no_show',
            'credit_consumed', coalesce(v_rule.no_show_deduct_credit, true),
            'credits_required', coalesce(r.credits_required, 1),
            'no_show_buffer_min', v_buffer
          )
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."process_no_show_bookings"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_payment public.payments%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_void_applied boolean := false;
  v_reason text;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if v_payment.status = 'refunded' then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_payment.status,
      'invoice_status', v_payment.invoice_status,
      'invoice_number', v_payment.invoice_number,
      'invoice_voided_at', v_payment.invoice_voided_at,
      'invoice_void_reason', v_payment.invoice_void_reason,
      'invoice_void_applied', v_payment.invoice_number is not null and v_payment.invoice_status = 'void'
    );
  end if;

  if v_payment.status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_paid');
  end if;

  v_before := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number
  );

  v_reason := case
    when p_reason is not null and length(trim(p_reason)) > 0 then trim(p_reason)
    else 'payment_refunded'
  end;

  if v_payment.invoice_number is not null then
    update public.payments
    set
      status = 'refunded',
      invoice_status = 'void',
      invoice_voided_at = now(),
      invoice_void_reason = v_reason
    where id = p_payment_id;
    v_void_applied := true;
  else
    update public.payments
    set status = 'refunded'
    where id = p_payment_id;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;

  v_after := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason
  );

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_operator_id,
    'staff',
    'payment_refund_invoice_void',
    'payment',
    p_payment_id,
    v_before,
    v_after
  );

  return jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason,
    'invoice_void_applied', v_void_applied
  );
end;
$$;


ALTER FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_studio_services_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_studio_services_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_member_studio_memberships_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_member_studio_memberships_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_row_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_row_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auth_access_anomalies" (
    "id" bigint NOT NULL,
    "anomaly_code" "text" NOT NULL,
    "user_id" "uuid",
    "email" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "detected_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."auth_access_anomalies" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auth_access_anomalies_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auth_access_anomalies_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."auth_access_anomalies_id_seq" OWNED BY "public"."auth_access_anomalies"."id";



CREATE TABLE IF NOT EXISTS "public"."booking_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "cancel_cutoff_hours" integer DEFAULT 12 NOT NULL,
    "late_cancel_deduct_credit" boolean DEFAULT true NOT NULL,
    "no_show_deduct_credit" boolean DEFAULT true NOT NULL,
    "allow_waitlist" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "no_show_buffer_min" integer DEFAULT 15 NOT NULL,
    "max_active_bookings_per_client" integer DEFAULT 3 NOT NULL,
    "max_weekly_late_cancel" integer DEFAULT 2 NOT NULL,
    "payment_verification_sla_min" integer DEFAULT 30 NOT NULL,
    CONSTRAINT "booking_rules_payment_verification_sla_min_check" CHECK ((("payment_verification_sla_min" >= 1) AND ("payment_verification_sla_min" <= 1440)))
);


ALTER TABLE "public"."booking_rules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."booking_rules"."payment_verification_sla_min" IS 'Minutes allowed before a pending payment is flagged overdue for staff verification';



CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "status" "text" DEFAULT 'booked'::"text" NOT NULL,
    "client_package_id" "uuid",
    "payment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "guest_name" "text",
    "guest_email" "text",
    "guest_phone" "text",
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "location_id" "uuid",
    "cancelled_at" timestamp with time zone,
    "checked_in_at" timestamp with time zone,
    "cancel_reason" "text",
    "no_show_marked_at" timestamp with time zone,
    "credit_policy_applied" "jsonb",
    "reminder_sent_at" timestamp with time zone,
    "outcome_notified_at" timestamp with time zone,
    "credit_consumed_at" timestamp with time zone,
    "credit_consumption_source" "text",
    "cancelled_by_studio_at" timestamp with time zone,
    "cancelled_by_studio_reason" "text",
    "credits_consumed" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "bookings_client_or_guest" CHECK ((("client_id" IS NOT NULL) OR (("guest_name" IS NOT NULL) AND (TRIM(BOTH FROM "guest_name") <> ''::"text") AND ("guest_email" IS NOT NULL) AND (TRIM(BOTH FROM "guest_email") <> ''::"text")))),
    CONSTRAINT "bookings_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'paid'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'booked'::"text", 'cancelled'::"text", 'attended'::"text", 'no_show'::"text", 'late_cancel'::"text", 'cancelled_by_studio'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "spots_left" integer NOT NULL,
    "location_id" "uuid",
    "capacity" integer,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "recurring_rule_id" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancelled_reason" "text",
    "cancelled_by" "uuid",
    "guest_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "credits_required" integer DEFAULT 1 NOT NULL,
    "share_slug" "text",
    CONSTRAINT "class_sessions_credits_required_check" CHECK (("credits_required" > 0)),
    CONSTRAINT "class_sessions_guest_price_check" CHECK (("guest_price" >= (0)::numeric)),
    CONSTRAINT "class_sessions_share_slug_format" CHECK ((("share_slug" IS NULL) OR ("share_slug" ~ '^[a-z0-9-]{6,80}$'::"text"))),
    CONSTRAINT "class_sessions_spots_left_check" CHECK (("spots_left" >= 0)),
    CONSTRAINT "class_sessions_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."class_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "instructor_id" "uuid",
    "capacity" integer NOT NULL,
    "duration_min" integer DEFAULT 60 NOT NULL,
    "location_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "share_slug" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text",
    "image_updated_at" timestamp with time zone,
    CONSTRAINT "classes_capacity_check" CHECK (("capacity" > 0)),
    CONSTRAINT "classes_share_slug_format" CHECK ((("share_slug" IS NULL) OR ("share_slug" ~ '^[a-z0-9-]{6,80}$'::"text")))
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."classes"."image_url" IS 'Public URL of cover image in storage bucket public-media';



CREATE TABLE IF NOT EXISTS "public"."client_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "package_id" "uuid" NOT NULL,
    "credits_left" integer NOT NULL,
    "expiry_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_packages_credits_left_check" CHECK (("credits_left" >= 0))
);


ALTER TABLE "public"."client_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guest_merge_audits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "merged_bookings" integer DEFAULT 0 NOT NULL,
    "merged_payments" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."guest_merge_audits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instructors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "email" "text",
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."instructors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_studio_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_studio_memberships_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."member_studio_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operation_audits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "before_state" "jsonb",
    "after_state" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."operation_audits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "credits" integer NOT NULL,
    "price" numeric(12,2) NOT NULL,
    "expiry_days" integer,
    "location_id" "uuid",
    "type" "text" DEFAULT 'class_pack'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "share_slug" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text",
    "image_updated_at" timestamp with time zone,
    CONSTRAINT "packages_credits_check" CHECK (("credits" > 0)),
    CONSTRAINT "packages_share_slug_format" CHECK ((("share_slug" IS NULL) OR ("share_slug" ~ '^[a-z0-9-]{6,80}$'::"text"))),
    CONSTRAINT "packages_type_check" CHECK (("type" = ANY (ARRAY['single'::"text", 'class_pack'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."packages"."image_url" IS 'Public URL of cover image in storage bucket public-media';



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "client_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "remaining_uses" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_id" "uuid",
    "package_id" "uuid",
    "currency" "text" DEFAULT 'SGD'::"text" NOT NULL,
    "payment_method" "text" DEFAULT 'paynow'::"text" NOT NULL,
    "reference_code" "text",
    "expires_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "location_id" "uuid",
    "customer_confirmed_at" timestamp with time zone,
    "customer_confirmation_note" "text",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "recon_status" "text" DEFAULT 'matched'::"text" NOT NULL,
    "paid_amount" numeric(12,2),
    "recon_note" "text",
    "invoice_number" "text",
    "invoice_sent_at" timestamp with time zone,
    "invoice_status" "text" DEFAULT 'issued'::"text" NOT NULL,
    "invoice_voided_at" timestamp with time zone,
    "invoice_void_reason" "text",
    "guest_name" "text",
    "guest_email" "text",
    "guest_phone" "text",
    "gateway_payment_id" "text",
    "gateway_checkout_url" "text",
    "gateway_status" "text",
    "gateway_payload" "text",
    "manual_refund_reference" "text",
    "manual_refund_recorded_at" timestamp with time zone,
    "manual_refund_recorded_by" "uuid",
    "gateway_refund_payment_id" "text",
    CONSTRAINT "payments_invoice_status_check" CHECK (("invoice_status" = ANY (ARRAY['issued'::"text", 'void'::"text"]))),
    CONSTRAINT "payments_recon_status_check" CHECK (("recon_status" = ANY (ARRAY['awaiting_verification'::"text", 'matched'::"text", 'mismatch'::"text", 'needs_review'::"text", 'manual_review'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text", 'expired'::"text", 'refunded'::"text"]))),
    CONSTRAINT "payments_type_check" CHECK (("type" = ANY (ARRAY['single'::"text", 'package'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."customer_confirmed_at" IS 'deprecated – no longer set; payments are confirmed by staff or auto-match only';



COMMENT ON COLUMN "public"."payments"."customer_confirmation_note" IS 'deprecated – no longer set';



CREATE TABLE IF NOT EXISTS "public"."platform_owner_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_owner_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "frequency" "text" NOT NULL,
    "interval_value" integer DEFAULT 1 NOT NULL,
    "by_weekday" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "start_time" time without time zone NOT NULL,
    "duration_min" integer DEFAULT 60 NOT NULL,
    "capacity" integer DEFAULT 10 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recurring_rules_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text"])))
);


ALTER TABLE "public"."recurring_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_invites_role_check" CHECK (("role" = ANY (ARRAY['manager'::"text", 'frontdesk'::"text", 'instructor'::"text"]))),
    CONSTRAINT "staff_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."staff_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_memberships_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'frontdesk'::"text", 'instructor'::"text"])))
);


ALTER TABLE "public"."staff_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_payment_secrets" (
    "studio_id" "uuid" NOT NULL,
    "hitpay_api_key" "text",
    "hitpay_webhook_salt" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."studio_payment_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "description" "text",
    "price" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'SGD'::"text" NOT NULL,
    "cover_image_url" "text",
    "gallery_images" "jsonb",
    "video_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "studio_services_currency_format" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "studio_services_price_non_negative" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."studio_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "public_slug" "text" NOT NULL,
    "contract_ends_at" timestamp with time zone,
    "contract_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "public_intro" "text",
    "public_cover_image_url" "text",
    "public_gallery_images" "jsonb",
    "public_video_url" "text",
    "whatsapp_enabled" boolean DEFAULT false NOT NULL,
    "whatsapp_number_e164" "text",
    "whatsapp_prefill_text" "text",
    "hitpay_enabled" boolean DEFAULT false NOT NULL,
    "hitpay_business_name" "text",
    CONSTRAINT "studios_contract_status_check" CHECK (("contract_status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."studios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auth_access_anomalies" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."auth_access_anomalies_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auth_access_anomalies"
    ADD CONSTRAINT "auth_access_anomalies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_rules"
    ADD CONSTRAINT "booking_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_sessions"
    ADD CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guest_merge_audits"
    ADD CONSTRAINT "guest_merge_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instructors"
    ADD CONSTRAINT "instructors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_studio_memberships"
    ADD CONSTRAINT "member_studio_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_studio_memberships"
    ADD CONSTRAINT "member_studio_memberships_user_id_studio_id_key" UNIQUE ("user_id", "studio_id");



ALTER TABLE ONLY "public"."operation_audits"
    ADD CONSTRAINT "operation_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_owner_grants"
    ADD CONSTRAINT "platform_owner_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_owner_grants"
    ADD CONSTRAINT "platform_owner_grants_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."recurring_rules"
    ADD CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."staff_memberships"
    ADD CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_payment_secrets"
    ADD CONSTRAINT "studio_payment_secrets_pkey" PRIMARY KEY ("studio_id");



ALTER TABLE ONLY "public"."studio_services"
    ADD CONSTRAINT "studio_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "idx_bookings_active_session_client" ON "public"."bookings" USING "btree" ("session_id", "client_id") WHERE (("status" = 'booked'::"text") AND ("client_id" IS NOT NULL));



CREATE UNIQUE INDEX "idx_bookings_active_session_guest_email" ON "public"."bookings" USING "btree" ("session_id", "guest_email") WHERE (("status" = 'booked'::"text") AND ("client_id" IS NULL) AND ("guest_email" IS NOT NULL));



CREATE INDEX "idx_bookings_location" ON "public"."bookings" USING "btree" ("location_id", "created_at" DESC);



CREATE INDEX "idx_bookings_session_status" ON "public"."bookings" USING "btree" ("session_id", "status");



CREATE UNIQUE INDEX "idx_class_sessions_share_slug" ON "public"."class_sessions" USING "btree" ("class_id", "share_slug") WHERE ("share_slug" IS NOT NULL);



CREATE INDEX "idx_classes_location" ON "public"."classes" USING "btree" ("location_id");



CREATE UNIQUE INDEX "idx_classes_studio_share_slug" ON "public"."classes" USING "btree" ("studio_id", "share_slug") WHERE ("share_slug" IS NOT NULL);



CREATE INDEX "idx_locations_studio" ON "public"."locations" USING "btree" ("studio_id");



CREATE INDEX "idx_member_studio_memberships_studio_status" ON "public"."member_studio_memberships" USING "btree" ("studio_id", "status");



CREATE INDEX "idx_member_studio_memberships_user_status" ON "public"."member_studio_memberships" USING "btree" ("user_id", "status");



CREATE INDEX "idx_operation_audits_action" ON "public"."operation_audits" USING "btree" ("action");



CREATE INDEX "idx_operation_audits_actor_created_at" ON "public"."operation_audits" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_operation_audits_created_at" ON "public"."operation_audits" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_packages_studio_share_slug" ON "public"."packages" USING "btree" ("studio_id", "share_slug") WHERE ("share_slug" IS NOT NULL);



CREATE INDEX "idx_payments_gateway_payment_id" ON "public"."payments" USING "btree" ("gateway_payment_id");



CREATE INDEX "idx_payments_gateway_refund_payment_id" ON "public"."payments" USING "btree" ("gateway_refund_payment_id");



CREATE INDEX "idx_payments_guest_email_lower" ON "public"."payments" USING "btree" ("lower"(TRIM(BOTH FROM "guest_email"))) WHERE (("guest_email" IS NOT NULL) AND ("client_id" IS NULL));



CREATE UNIQUE INDEX "idx_payments_invoice_number_unique" ON "public"."payments" USING "btree" ("invoice_number") WHERE ("invoice_number" IS NOT NULL);



CREATE INDEX "idx_payments_location" ON "public"."payments" USING "btree" ("location_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_payments_reference_code_unique" ON "public"."payments" USING "btree" ("reference_code") WHERE ("reference_code" IS NOT NULL);



CREATE INDEX "idx_payments_studio_booking" ON "public"."payments" USING "btree" ("studio_id", "booking_id");



CREATE INDEX "idx_payments_studio_invoice_status_created_at" ON "public"."payments" USING "btree" ("studio_id", "invoice_status", "created_at" DESC);



CREATE INDEX "idx_payments_studio_recon_verified" ON "public"."payments" USING "btree" ("studio_id", "recon_status", "verified_at");



CREATE INDEX "idx_payments_studio_status_created_desc" ON "public"."payments" USING "btree" ("studio_id", "status", "created_at" DESC);



CREATE INDEX "idx_sessions_location" ON "public"."class_sessions" USING "btree" ("location_id", "start_time");



CREATE INDEX "idx_staff_invites_email_status" ON "public"."staff_invites" USING "btree" ("email", "status");



CREATE UNIQUE INDEX "idx_staff_invites_pending_unique" ON "public"."staff_invites" USING "btree" ("studio_id", "lower"("email")) WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_staff_invites_studio_status" ON "public"."staff_invites" USING "btree" ("studio_id", "status");



CREATE INDEX "idx_staff_memberships_user" ON "public"."staff_memberships" USING "btree" ("user_id", "studio_id");



CREATE INDEX "idx_studio_services_studio_active_sort" ON "public"."studio_services" USING "btree" ("studio_id", "is_active", "sort_order", "created_at" DESC);



CREATE INDEX "idx_studios_owner_id" ON "public"."studios" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "studios_public_slug_lower" ON "public"."studios" USING "btree" ("lower"("public_slug"));



CREATE OR REPLACE TRIGGER "classes_touch_updated_at" BEFORE UPDATE ON "public"."classes" FOR EACH ROW EXECUTE FUNCTION "public"."touch_row_updated_at"();



CREATE OR REPLACE TRIGGER "on_public_user_merge_guest" AFTER INSERT OR UPDATE OF "email" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_user_guest_merge"();



CREATE OR REPLACE TRIGGER "packages_touch_updated_at" BEFORE UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."touch_row_updated_at"();



CREATE OR REPLACE TRIGGER "trg_member_studio_memberships_updated_at" BEFORE UPDATE ON "public"."member_studio_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."touch_member_studio_memberships_updated_at"();



CREATE OR REPLACE TRIGGER "trg_studio_services_updated_at" BEFORE UPDATE ON "public"."studio_services" FOR EACH ROW EXECUTE FUNCTION "public"."set_studio_services_updated_at"();



ALTER TABLE ONLY "public"."booking_rules"
    ADD CONSTRAINT "booking_rules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_rules"
    ADD CONSTRAINT "booking_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_client_package_id_fkey" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_sessions"
    ADD CONSTRAINT "class_sessions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."class_sessions"
    ADD CONSTRAINT "class_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_sessions"
    ADD CONSTRAINT "class_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."class_sessions"
    ADD CONSTRAINT "class_sessions_recurring_rule_id_fkey" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_packages"
    ADD CONSTRAINT "client_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guest_merge_audits"
    ADD CONSTRAINT "guest_merge_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructors"
    ADD CONSTRAINT "instructors_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."instructors"
    ADD CONSTRAINT "instructors_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_studio_memberships"
    ADD CONSTRAINT "member_studio_memberships_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_studio_memberships"
    ADD CONSTRAINT "member_studio_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operation_audits"
    ADD CONSTRAINT "operation_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_manual_refund_recorded_by_fkey" FOREIGN KEY ("manual_refund_recorded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_owner_grants"
    ADD CONSTRAINT "platform_owner_grants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_owner_grants"
    ADD CONSTRAINT "platform_owner_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_rules"
    ADD CONSTRAINT "recurring_rules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_rules"
    ADD CONSTRAINT "recurring_rules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_memberships"
    ADD CONSTRAINT "staff_memberships_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_memberships"
    ADD CONSTRAINT "staff_memberships_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_memberships"
    ADD CONSTRAINT "staff_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_payment_secrets"
    ADD CONSTRAINT "studio_payment_secrets_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_services"
    ADD CONSTRAINT "studio_services_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."booking_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_rules_owner_manage" ON "public"."booking_rules" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "booking_rules"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "booking_rules"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "booking_rules_staff_read" ON "public"."booking_rules" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."staff_memberships" "sm"
  WHERE (("sm"."studio_id" = "booking_rules"."studio_id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "booking_rules"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))));



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings_client_select" ON "public"."bookings" FOR SELECT USING (("auth"."uid"() = "client_id"));



CREATE POLICY "bookings_owner_select" ON "public"."bookings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."class_sessions" "cs"
     JOIN "public"."classes" "c" ON (("c"."id" = "cs"."class_id")))
     JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("cs"."id" = "bookings"."session_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "bookings_owner_update" ON "public"."bookings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."class_sessions" "cs"
     JOIN "public"."classes" "c" ON (("c"."id" = "cs"."class_id")))
     JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("cs"."id" = "bookings"."session_id") AND ("s"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."class_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "classes_owner_write" ON "public"."classes" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "classes"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "classes"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "classes_read" ON "public"."classes" FOR SELECT USING (true);



ALTER TABLE "public"."client_packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_packages_owner_select" ON "public"."client_packages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."packages" "p"
     JOIN "public"."studios" "s" ON (("s"."id" = "p"."studio_id")))
  WHERE (("p"."id" = "client_packages"."package_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "client_packages_self" ON "public"."client_packages" FOR SELECT USING (("auth"."uid"() = "client_id"));



ALTER TABLE "public"."instructors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "instructors_owner_write" ON "public"."instructors" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "instructors"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "instructors"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "instructors_read" ON "public"."instructors" FOR SELECT USING (true);



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_owner_manage" ON "public"."locations" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "locations"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "locations"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "locations_staff_read" ON "public"."locations" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."staff_memberships" "sm"
  WHERE (("sm"."studio_id" = "locations"."studio_id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "locations"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "owners_read_booking_clients" ON "public"."users" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((("public"."bookings" "b"
     JOIN "public"."class_sessions" "cs" ON (("cs"."id" = "b"."session_id")))
     JOIN "public"."classes" "c" ON (("c"."id" = "cs"."class_id")))
     JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("b"."client_id" = "users"."id") AND ("s"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages_owner_write" ON "public"."packages" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "packages"."studio_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "packages"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "packages_read" ON "public"."packages" FOR SELECT USING (true);



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_owner_select" ON "public"."payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "payments"."studio_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "payments_self" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "client_id"));



ALTER TABLE "public"."recurring_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recurring_rules_staff_read" ON "public"."recurring_rules" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."classes" "c"
     LEFT JOIN "public"."staff_memberships" "sm" ON ((("sm"."studio_id" = "c"."studio_id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true))))
     LEFT JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("c"."id" = "recurring_rules"."class_id") AND (("sm"."user_id" IS NOT NULL) OR ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "sessions_owner_write" ON "public"."class_sessions" USING ((EXISTS ( SELECT 1
   FROM ("public"."classes" "c"
     JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("c"."id" = "class_sessions"."class_id") AND ("s"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."classes" "c"
     JOIN "public"."studios" "s" ON (("s"."id" = "c"."studio_id")))
  WHERE (("c"."id" = "class_sessions"."class_id") AND ("s"."owner_id" = "auth"."uid"())))));



CREATE POLICY "sessions_read" ON "public"."class_sessions" FOR SELECT USING (true);



ALTER TABLE "public"."staff_memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_memberships_self_read" ON "public"."staff_memberships" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."studio_payment_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "studio_services_staff_read" ON "public"."studio_services" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "studio_services"."studio_id") AND (("s"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."staff_memberships" "sm"
          WHERE (("sm"."studio_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true) AND ("sm"."role" = ANY (ARRAY['owner'::"text", 'manager'::"text"]))))))))));



CREATE POLICY "studio_services_staff_write" ON "public"."studio_services" USING ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "studio_services"."studio_id") AND (("s"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."staff_memberships" "sm"
          WHERE (("sm"."studio_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true) AND ("sm"."role" = ANY (ARRAY['owner'::"text", 'manager'::"text"])))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."studios" "s"
  WHERE (("s"."id" = "studio_services"."studio_id") AND (("s"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."staff_memberships" "sm"
          WHERE (("sm"."studio_id" = "s"."id") AND ("sm"."user_id" = "auth"."uid"()) AND ("sm"."is_active" = true) AND ("sm"."role" = ANY (ARRAY['owner'::"text", 'manager'::"text"]))))))))));



ALTER TABLE "public"."studios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "studios_owner_write" ON "public"."studios" USING ((("auth"."uid"() = "owner_id") AND ((EXISTS ( SELECT 1
   FROM "public"."platform_owner_grants" "g"
  WHERE (("g"."user_id" = "auth"."uid"()) AND ("g"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."staff_memberships" "sm"
  WHERE (("sm"."user_id" = "auth"."uid"()) AND ("sm"."studio_id" = "studios"."id") AND ("sm"."role" = 'owner'::"text") AND ("sm"."is_active" = true))))))) WITH CHECK ((("auth"."uid"() = "owner_id") AND ((EXISTS ( SELECT 1
   FROM "public"."platform_owner_grants" "g"
  WHERE (("g"."user_id" = "auth"."uid"()) AND ("g"."is_active" = true)))) OR (EXISTS ( SELECT 1
   FROM "public"."staff_memberships" "sm"
  WHERE (("sm"."user_id" = "auth"."uid"()) AND ("sm"."studio_id" = "studios"."id") AND ("sm"."role" = 'owner'::"text") AND ("sm"."is_active" = true)))))));



CREATE POLICY "studios_read_future_booking" ON "public"."studios" FOR SELECT USING (true);



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profiles_self" ON "public"."user_profiles" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_self" ON "public"."users" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































GRANT ALL ON FUNCTION "public"."assign_payment_invoice_number"("p_payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_payment_invoice_number"("p_payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_payment_invoice_number"("p_payment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."book_session"("p_session_id" "uuid", "p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."book_session"("p_session_id" "uuid", "p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."book_session"("p_session_id" "uuid", "p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."book_session_guest"("p_session_id" "uuid", "p_studio_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."book_session_guest"("p_session_id" "uuid", "p_studio_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."book_session_guest"("p_session_id" "uuid", "p_studio_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_booking_with_rules"("p_booking_id" "uuid", "p_actor_id" "uuid", "p_cancel_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking_with_rules"("p_booking_id" "uuid", "p_actor_id" "uuid", "p_cancel_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking_with_rules"("p_booking_id" "uuid", "p_actor_id" "uuid", "p_cancel_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_pending_payment"("p_payment_id" "uuid", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_pending_payment"("p_payment_id" "uuid", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_pending_payment"("p_payment_id" "uuid", "p_new_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_session_with_settlement"("p_session_id" "uuid", "p_actor_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkin_booking"("p_booking_id" "uuid", "p_actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."checkin_booking"("p_booking_id" "uuid", "p_actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkin_booking"("p_booking_id" "uuid", "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_payment"("p_payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_payment"("p_payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_payment"("p_payment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_payment_with_invoice"("p_payment_id" "uuid", "p_verified_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_paynow_payment"("p_payment_id" "uuid", "p_force" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_paynow_payment"("p_payment_id" "uuid", "p_force" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_paynow_payment"("p_payment_id" "uuid", "p_force" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_booking_credit_once"("p_booking_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_booking_credit_once"("p_booking_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_booking_credit_once"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_member_booking_auto"("p_session_id" "uuid", "p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_member_booking_auto"("p_session_id" "uuid", "p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_member_booking_auto"("p_session_id" "uuid", "p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_package_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_client_package_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_pending_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_pending_booking"("p_session_id" "uuid", "p_client_id" "uuid", "p_guest_name" "text", "p_guest_email" "text", "p_guest_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."disable_owner_grant_and_suspend_studios"("p_owner_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_pending_payments"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_pending_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_pending_payments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_guest_merge"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_guest_merge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_guest_merge"() TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_guest_records_for_user"("p_user_id" "uuid", "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_guest_records_for_user"("p_user_id" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_guest_records_for_user"("p_user_id" "uuid", "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_no_show_bookings"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."process_no_show_bookings"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_no_show_bookings"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refund_payment_with_invoice_void"("p_payment_id" "uuid", "p_operator_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_studio_services_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_studio_services_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_studio_services_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_member_studio_memberships_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_member_studio_memberships_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_member_studio_memberships_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_row_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_row_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_row_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."auth_access_anomalies" TO "anon";
GRANT ALL ON TABLE "public"."auth_access_anomalies" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_access_anomalies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auth_access_anomalies_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auth_access_anomalies_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auth_access_anomalies_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_rules" TO "anon";
GRANT ALL ON TABLE "public"."booking_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_rules" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."class_sessions" TO "anon";
GRANT ALL ON TABLE "public"."class_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."class_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON TABLE "public"."client_packages" TO "anon";
GRANT ALL ON TABLE "public"."client_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."client_packages" TO "service_role";



GRANT ALL ON TABLE "public"."guest_merge_audits" TO "anon";
GRANT ALL ON TABLE "public"."guest_merge_audits" TO "authenticated";
GRANT ALL ON TABLE "public"."guest_merge_audits" TO "service_role";



GRANT ALL ON TABLE "public"."instructors" TO "anon";
GRANT ALL ON TABLE "public"."instructors" TO "authenticated";
GRANT ALL ON TABLE "public"."instructors" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."member_studio_memberships" TO "anon";
GRANT ALL ON TABLE "public"."member_studio_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."member_studio_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."operation_audits" TO "anon";
GRANT ALL ON TABLE "public"."operation_audits" TO "authenticated";
GRANT ALL ON TABLE "public"."operation_audits" TO "service_role";



GRANT ALL ON TABLE "public"."packages" TO "anon";
GRANT ALL ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."platform_owner_grants" TO "anon";
GRANT ALL ON TABLE "public"."platform_owner_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_owner_grants" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_rules" TO "anon";
GRANT ALL ON TABLE "public"."recurring_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_rules" TO "service_role";



GRANT ALL ON TABLE "public"."staff_invites" TO "anon";
GRANT ALL ON TABLE "public"."staff_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_invites" TO "service_role";



GRANT ALL ON TABLE "public"."staff_memberships" TO "anon";
GRANT ALL ON TABLE "public"."staff_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."studio_payment_secrets" TO "anon";
GRANT ALL ON TABLE "public"."studio_payment_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_payment_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."studio_services" TO "anon";
GRANT ALL ON TABLE "public"."studio_services" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_services" TO "service_role";



GRANT ALL ON TABLE "public"."studios" TO "anon";
GRANT ALL ON TABLE "public"."studios" TO "authenticated";
GRANT ALL ON TABLE "public"."studios" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;

--
