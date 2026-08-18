\set ON_ERROR_STOP on

insert into public.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', 'manager-a@example.com'),
  ('a0000000-0000-0000-0000-000000000003', 'frontdesk-a@example.com')
on conflict (id) do nothing;

insert into public.studios (id, owner_id, contract_status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'A-L1', true)
on conflict (id) do nothing;

insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', null, 'manager', true),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'frontdesk', true)
on conflict (id) do nothing;

insert into public.salon_customers (id, studio_id, full_name, email, phone, status, source) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Pat Lee', 'pat@example.com', '81111111', 'active', 'frontdesk')
on conflict (id) do nothing;

insert into public.salon_appointments (id, studio_id, location_id, salon_customer_id, starts_at, status, service_title_snapshot) values
  ('aa000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', now() - interval '2000 days', 'completed', 'Facial')
on conflict (id) do nothing;

-- 1) publish notice and record versioned privacy consent
do $$
declare
  v_publish jsonb;
  v_consent jsonb;
  v_version text;
begin
  if (select customer_retention_days from public.studios where id = 'b0000000-0000-0000-0000-000000000001') <> 1825 then
    raise exception 'expected default customer retention 1825';
  end if;

  v_publish := public.publish_salon_privacy_notice(
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'owner',
    'privacy-v1.0',
    'hash-privacy-v1',
    jsonb_build_object('collected', jsonb_build_array('Name', 'Email'), 'purposes', jsonb_build_array('Booking'))
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is false then
    raise exception 'publish privacy notice failed: %', v_publish;
  end if;
  v_version := v_publish ->> 'versionLabel';

  v_consent := public.record_salon_customer_privacy_consent(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    'frontdesk',
    'granted',
    'frontdesk',
    v_version,
    '{}'::jsonb,
    now(),
    'c0000000-0000-0000-0000-000000000001',
    null,
    null,
    null
  );
  if coalesce((v_consent ->> 'ok')::boolean, false) is false then
    raise exception 'privacy consent failed: %', v_consent;
  end if;
  if not exists (
    select 1 from public.salon_customer_consents
    where salon_customer_id = 'f0000000-0000-0000-0000-000000000001'
      and consent_key = 'privacy_notice'
      and text_version = 'privacy-v1.0'
      and status = 'granted'
  ) then
    raise exception 'expected privacy_notice consent with version label';
  end if;
end;
$$;

-- 2) DSAR create + complete, then append-only
do $$
declare
  v_create jsonb;
  v_complete jsonb;
  v_id uuid;
begin
  v_create := public.create_salon_customer_data_request(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    'frontdesk',
    'access',
    'I want to see my record',
    'c0000000-0000-0000-0000-000000000001'
  );
  v_id := (v_create ->> 'id')::uuid;
  v_complete := public.complete_salon_customer_data_request(
    'b0000000-0000-0000-0000-000000000001',
    v_id,
    'a0000000-0000-0000-0000-000000000003',
    'frontdesk',
    'completed',
    'Shown the profile',
    'c0000000-0000-0000-0000-000000000001'
  );
  if coalesce((v_complete ->> 'ok')::boolean, false) is false then
    raise exception 'complete DSAR failed: %', v_complete;
  end if;

  begin
    update public.salon_customer_data_requests
    set staff_note = 'tamper'
    where id = v_id;
    raise exception 'expected closed DSAR update to fail';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

-- 3) frontdesk cannot anonymize; owner can, second call fails, PII masked
do $$
declare
  v_result jsonb;
begin
  begin
    perform public.anonymize_salon_customer(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000003',
      'frontdesk',
      'c0000000-0000-0000-0000-000000000001'
    );
    raise exception 'expected frontdesk anonymize denial';
  exception when sqlstate '42501' then
    null;
  end;

  v_result := public.anonymize_salon_customer(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'owner',
    null
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is false then
    raise exception 'anonymize failed: %', v_result;
  end if;

  if exists (
    select 1 from public.salon_customers
    where id = 'f0000000-0000-0000-0000-000000000001'
      and (email is not null or phone is not null or full_name <> 'Anonymized' or anonymized_at is null or status <> 'inactive')
  ) then
    raise exception 'anonymize did not mask customer PII';
  end if;

  begin
    perform public.anonymize_salon_customer(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000001',
      'owner',
      null
    );
    raise exception 'expected second anonymize to fail';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

-- 4) retention review
do $$
declare
  v_result jsonb;
begin
  v_result := public.mark_salon_appointment_retention_reviewed(
    'b0000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'manager'
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is false then
    raise exception 'retention review failed: %', v_result;
  end if;
  if exists (
    select 1 from public.salon_appointments
    where id = 'aa000000-0000-0000-0000-000000000001'
      and retention_reviewed_at is null
  ) then
    raise exception 'expected retention_reviewed_at to be set';
  end if;
end;
$$;

-- 5) anon/authenticated cannot execute privileged RPC
do $$
begin
  execute 'set local role authenticated';
  begin
    perform public.publish_salon_privacy_notice(
      'b0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000001',
      'owner',
      'privacy-v2.0',
      'hash-privacy-v2',
      '{}'::jsonb
    );
    raise exception 'expected authenticated execute denial';
  exception when sqlstate '42501' then
    null;
  end;
  execute 'reset role';
end;
$$;

select 'verify-cmp01-pdpa-controls: ok' as result;
