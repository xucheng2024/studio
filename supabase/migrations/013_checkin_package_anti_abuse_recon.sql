alter table public.booking_rules
  add column if not exists max_active_bookings_per_client int not null default 3,
  add column if not exists max_weekly_late_cancel int not null default 2;

alter table public.payments
  add column if not exists recon_status text not null default 'matched',
  add column if not exists paid_amount numeric(12, 2),
  add column if not exists recon_note text;

update public.payments
set paid_amount = coalesce(paid_amount, amount)
where paid_amount is null;

alter table public.payments
  drop constraint if exists payments_status_check;

alter table public.payments
  add constraint payments_status_check check (status in ('pending', 'paid', 'failed', 'expired', 'refunded'));

alter table public.payments
  drop constraint if exists payments_recon_status_check;

alter table public.payments
  add constraint payments_recon_status_check check (recon_status in ('matched', 'mismatch', 'manual_review'));

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
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'consumed', false, 'source', null, 'error', 'booking_not_found');
  end if;
  if b.credit_consumed_at is not null then
    return jsonb_build_object('ok', true, 'consumed', true, 'source', b.credit_consumption_source, 'error', null);
  end if;

  if b.client_package_id is not null then
    select * into cp from public.client_packages where id = b.client_package_id for update;
    if found and cp.credits_left > 0 and (cp.expiry_date is null or cp.expiry_date > now()) then
      update public.client_packages set credits_left = credits_left - 1 where id = cp.id;
      update public.bookings
        set credit_consumed_at = now(),
            credit_consumption_source = 'package',
            credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
              jsonb_build_object('credit_consumed_reason', p_reason, 'credit_source', 'package')
      where id = b.id;
      return jsonb_build_object('ok', true, 'consumed', true, 'source', 'package', 'error', null);
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
      return jsonb_build_object('ok', true, 'consumed', true, 'source', 'single', 'error', null);
    end if;
    return jsonb_build_object('ok', false, 'consumed', false, 'source', 'single', 'error', 'no_credit_source');
  end if;

  return jsonb_build_object('ok', true, 'consumed', false, 'source', 'none', 'error', null);
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
  select cs.id, cs.spots_left, cs.location_id, c.studio_id
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

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
  select cs.id, cs.spots_left, cs.location_id, c.studio_id
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'studio_id', v_session.studio_id, 'location_id', v_session.location_id);
end;
$$;

create or replace function public.checkin_booking(
  p_booking_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_session record;
  v_authorized boolean := false;
  v_credit jsonb;
  v_consumed boolean := false;
  v_credit_ok boolean := false;
  v_is_exempt boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_booked');
  end if;

  select cs.id as session_id, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id;

  v_authorized := exists (
    select 1 from public.studios s where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1 from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_session.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk', 'instructor')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );
  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_credit := public.consume_booking_credit_once(b.id, 'checkin');
  v_credit_ok := coalesce((v_credit->>'ok')::boolean, false);
  v_consumed := coalesce((v_credit->>'consumed')::boolean, false);
  v_is_exempt := b.client_package_id is null and b.payment_id is null;

  if not v_credit_ok then
    return jsonb_build_object('ok', false, 'error', coalesce(v_credit->>'error', 'credit_consume_failed'));
  end if;
  if not v_consumed and not v_is_exempt then
    return jsonb_build_object('ok', false, 'error', 'no_credit_source');
  end if;

  update public.bookings
    set status = 'attended',
        checked_in_at = now(),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
          jsonb_build_object('checkin_by', p_actor_id::text, 'checkin_at', now())
  where id = b.id;

  return jsonb_build_object('ok', true, 'credit', v_credit);
end;
$$;

grant execute on function public.create_package_booking(uuid, uuid, uuid) to service_role;
