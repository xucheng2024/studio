\set ON_ERROR_STOP on

select set_config('ops_uat.studio_id', :'ops_uat_studio_id', false);
select set_config('ops_uat.location_id', :'ops_uat_location_id', false);
select set_config('ops_uat.class_id', :'ops_uat_class_id', false);
select set_config('ops_uat.session_id', :'ops_uat_session_id', false);
select set_config('ops_uat.event_id', :'ops_uat_event_id', false);
select set_config('ops_uat.pending_booking_id', :'ops_uat_pending_booking_id', false);
select set_config('ops_uat.booked_booking_id', :'ops_uat_booked_booking_id', false);
select set_config('ops_uat.attended_booking_id', :'ops_uat_attended_booking_id', false);
select set_config('ops_uat.pending_event_booking_id', :'ops_uat_pending_event_booking_id', false);
select set_config('ops_uat.class_payment_id', :'ops_uat_class_payment_id', false);
select set_config('ops_uat.event_payment_id', :'ops_uat_event_payment_id', false);

do $$
declare
  v_studio uuid := current_setting('ops_uat.studio_id')::uuid;
  v_location uuid := current_setting('ops_uat.location_id')::uuid;
  v_class uuid := current_setting('ops_uat.class_id')::uuid;
  v_session uuid := current_setting('ops_uat.session_id')::uuid;
  v_event uuid := current_setting('ops_uat.event_id')::uuid;
  v_pending_booking uuid := current_setting('ops_uat.pending_booking_id')::uuid;
  v_booked_booking uuid := current_setting('ops_uat.booked_booking_id')::uuid;
  v_attended_booking uuid := current_setting('ops_uat.attended_booking_id')::uuid;
  v_pending_event_booking uuid := current_setting('ops_uat.pending_event_booking_id')::uuid;
  v_class_payment uuid := current_setting('ops_uat.class_payment_id')::uuid;
  v_event_payment uuid := current_setting('ops_uat.event_payment_id')::uuid;
  v_owner uuid := 'a0f75410-cfb7-4ea1-80e2-d28137c40ecb';
  v_instructor uuid := '7a2c25b3-6d9d-46a1-8fc7-23bef27f1185';
  v_start timestamptz := ((timezone('Asia/Singapore', now()))::date + time '15:00') at time zone 'Asia/Singapore';
  v_end timestamptz := v_start + interval '60 minutes';
begin
  if exists (
    select 1 from (values
      (v_owner, 'ops-local-owner@example.test'), (v_instructor, 'ops-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'ops local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'ops-local-owner@example.test'), (v_instructor, 'ops-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'ops-local-owner@example.test', 'Ops local owner', 'member'),
    (v_instructor, 'ops-local-instructor@example.test', 'Ops local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;

  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, 'Ops local UAT', 'ops-local-' || left(replace(v_studio::text, '-', ''), 12), 'active');
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'Ops Local', true);
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);

  insert into public.classes (id, studio_id, location_id, title, capacity, duration_min, is_active)
    values (v_class, v_studio, v_location, 'Ops UAT Class', 5, 60, true);

  insert into public.class_sessions (
    id, class_id, location_id, class_title_snapshot, start_time, end_time, capacity, spots_left, status, guest_price, credits_required
  ) values (
    v_session, v_class, v_location, 'Ops UAT Class', v_start, v_end, 5, 1, 'scheduled', 20, 1
  );

  insert into public.bookings (id, session_id, location_id, status, payment_status, guest_name, guest_email) values
    (v_pending_booking, v_session, v_location, 'pending', 'pending', 'Ops Unpaid Guest', 'ops-unpaid@example.test'),
    (v_booked_booking, v_session, v_location, 'booked', 'paid', 'Ops Booked Guest', 'ops-booked@example.test'),
    (v_attended_booking, v_session, v_location, 'attended', 'paid', 'Ops Attended Guest', 'ops-attended@example.test');

  insert into public.events (
    id, studio_id, location_id, title, start_time, end_time, capacity, spots_left, price, currency, is_active
  ) values (
    v_event, v_studio, v_location, 'Ops UAT Event', v_start, v_end, 5, 1, 25, 'SGD', true
  );

  insert into public.event_bookings (id, event_id, location_id, status, payment_status, guest_name, guest_email) values
    (v_pending_event_booking, v_event, v_location, 'pending', 'pending', 'Ops Event Unpaid', 'ops-event-unpaid@example.test');

  insert into public.payments (
    id, studio_id, location_id, booking_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_class_payment, v_studio, v_location, v_pending_booking, 20, 'SGD', 'cash', 'frontdesk', 'online_booking', 'pending',
    'OPS-CLASS-' || left(replace(v_class_payment::text, '-', ''), 16), 'single', 0
  );

  insert into public.payments (
    id, studio_id, location_id, event_booking_id, amount, currency, payment_method, sales_channel, source, status, reference_code, type, remaining_uses
  ) values (
    v_event_payment, v_studio, v_location, v_pending_event_booking, 25, 'SGD', 'cash', 'frontdesk', 'event_booking', 'pending',
    'OPS-EVENT-' || left(replace(v_event_payment::text, '-', ''), 16), 'single', 0
  );
end $$;
