-- Session-level pricing and credit cost model.

alter table public.class_sessions
  add column if not exists guest_price numeric(12, 2) not null default 0,
  add column if not exists credits_required int not null default 1;

alter table public.class_sessions
  drop constraint if exists class_sessions_guest_price_check;

alter table public.class_sessions
  add constraint class_sessions_guest_price_check check (guest_price >= 0);

alter table public.class_sessions
  drop constraint if exists class_sessions_credits_required_check;

alter table public.class_sessions
  add constraint class_sessions_credits_required_check check (credits_required > 0);

alter table public.packages
  add column if not exists is_active boolean not null default true;

with drop_in_price as (
  select distinct on (studio_id)
    studio_id,
    price
  from public.packages
  where is_drop_in = true
  order by studio_id, id
)
update public.class_sessions cs
set
  guest_price = coalesce(d.price, 25),
  credits_required = 1
from public.classes c
left join drop_in_price d on d.studio_id = c.studio_id
where c.id = cs.class_id
  and (cs.guest_price = 0 or cs.credits_required is null);

create or replace function public.create_pending_booking(
  p_session_id uuid,
  p_client_id uuid default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_rule record;
  v_active_count int := 0;
  v_weekly_late int := 0;
  v_booking_id uuid;
  v_guest_email text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select cs.id, cs.spots_left, cs.location_id, cs.guest_price, cs.credits_required, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if v_session.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null and exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id and b.client_id = p_client_id and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email and b.status in ('pending', 'booked')
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

  insert into public.bookings (
    session_id, location_id, client_id, guest_name, guest_email, guest_phone, status, payment_status
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
    'location_id', v_session.location_id,
    'guest_price', v_session.guest_price,
    'credits_required', v_session.credits_required
  );
end;
$$;

create or replace function public.create_package_booking(
  p_session_id uuid,
  p_client_id uuid,
  p_client_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  cp record;
  v_rule record;
  v_active_count int := 0;
  v_weekly_late int := 0;
  v_booking_id uuid;
begin
  select cs.id, cs.spots_left, cs.location_id, cs.credits_required, c.studio_id
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  select cp.id, cp.client_id, cp.credits_left, cp.expiry_date, pkg.id as package_id, pkg.studio_id, pkg.location_id
  into cp
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.id = p_client_package_id
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
      and b.client_id = p_client_id
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
    session_id,
    location_id,
    client_id,
    status,
    payment_status,
    client_package_id
  ) values (
    p_session_id,
    s.location_id,
    p_client_id,
    'booked',
    'paid',
    p_client_package_id
  ) returning id into v_booking_id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'credits_required', s.credits_required
  );
end;
$$;

create or replace function public.consume_booking_credit_once(p_booking_id uuid, p_reason text default 'checkin')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.process_no_show_bookings(
  p_limit int default 500
)
returns int
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.cancel_session_with_settlement(
  p_session_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_booking record;
  v_pay record;
  v_reason text;
  v_refund jsonb;
  v_affected int := 0;
  v_credits int := 0;
  v_refunds int := 0;
  v_errors int := 0;
  v_already_cancelled int := 0;
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
    select b.*, cs.credits_required
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    where b.session_id = p_session_id
      and b.status in ('pending', 'booked')
    for update of b
  loop
    update public.bookings
    set
      status = 'cancelled_by_studio',
      cancelled_by_studio_at = now(),
      cancelled_by_studio_reason = v_reason
    where id = v_booking.id;

    update public.class_sessions
    set spots_left = spots_left + 1
    where id = p_session_id;

    v_affected := v_affected + 1;

    if v_booking.credit_consumed_at is not null then
      if v_booking.client_package_id is not null then
        update public.client_packages
        set credits_left = credits_left + coalesce(v_booking.credits_required, 1)
        where id = v_booking.client_package_id;
        v_credits := v_credits + coalesce(v_booking.credits_required, 1);
      elsif v_booking.payment_id is not null then
        update public.payments
        set remaining_uses = coalesce(remaining_uses, 0) + 1
        where id = v_booking.payment_id;
        v_credits := v_credits + 1;
      end if;
    end if;

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

revoke all on function public.cancel_session_with_settlement(uuid, uuid, text) from public;
grant execute on function public.cancel_session_with_settlement(uuid, uuid, text) to service_role;
