\set ON_ERROR_STOP on

truncate table
  public.salon_treatment_follow_up_history,
  public.salon_treatment_follow_ups,
  public.salon_treatment_revisions,
  public.salon_treatments,
  public.salon_appointment_status_history,
  public.salon_appointment_resources,
  public.salon_appointments,
  public.strong_audit_logs,
  public.business_idempotency_keys,
  public.service_employees,
  public.employee_locations,
  public.employees,
  public.salon_customers,
  public.service_locations,
  public.studio_services,
  public.staff_memberships,
  public.locations,
  public.studios,
  public.users
restart identity cascade;

insert into public.users (id, email) values
  ('91000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('91000000-0000-0000-0000-000000000002', 'manager-global-a@example.com'),
  ('91000000-0000-0000-0000-000000000003', 'manager-l1-a@example.com'),
  ('91000000-0000-0000-0000-000000000004', 'frontdesk-l1-a@example.com'),
  ('91000000-0000-0000-0000-000000000005', 'instructor-l1-a@example.com'),
  ('91000000-0000-0000-0000-000000000006', 'instructor-l2-a@example.com'),
  ('91000000-0000-0000-0000-000000000007', 'owner-b@example.com')
on conflict (id) do nothing;

insert into public.studios (id, owner_id, contract_status) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'active'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000007', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active) values
  ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'A-L1', true),
  ('93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', 'A-L2', true),
  ('93000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', 'B-L1', true)
on conflict (id) do nothing;

insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
  ('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', null, 'manager', true),
  ('94000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'manager', true),
  ('94000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'frontdesk', true),
  ('94000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000005', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'instructor', true),
  ('94000000-0000-0000-0000-000000000005', '91000000-0000-0000-0000-000000000006', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002', 'instructor', true)
on conflict (id) do nothing;

insert into public.studio_services (id, studio_id, name, price, currency, is_active, default_duration_minutes, default_prep_minutes, default_buffer_minutes) values
  ('95000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'Facial A', 120, 'SGD', true, 60, 10, 10),
  ('95000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000002', 'Facial B', 110, 'SGD', true, 60, 10, 10)
on conflict (id) do nothing;

insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values) values
  ('92000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', true, true),
  ('92000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002', true, true),
  ('92000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003', true, true)
on conflict (service_id, location_id) do update set is_enabled = excluded.is_enabled;

insert into public.salon_customers (id, studio_id, full_name, status, source) values
  ('96000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'Customer A', 'active', 'frontdesk'),
  ('96000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000002', 'Customer B', 'active', 'frontdesk')
on conflict (id) do nothing;

insert into public.employees (id, studio_id, user_id, display_name, employment_status, is_active) values
  ('97000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000005', 'Inst L1', 'active', true),
  ('97000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000006', 'Inst L2', 'active', true),
  ('97000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', null, 'Inst B1', 'active', true)
on conflict (id) do nothing;

insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active) values
  ('97000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', true, true),
  ('97000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', true, true),
  ('97000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', true, true)
on conflict do nothing;

insert into public.service_employees (studio_id, service_id, employee_id, is_active) values
  ('92000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', true),
  ('92000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000002', true),
  ('92000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000003', true)
on conflict (service_id, employee_id) do update set is_active = excluded.is_active;

insert into public.salon_appointments (
  id, studio_id, location_id, salon_customer_id, service_id, employee_id,
  status, starts_at, ends_at, occupied_from, occupied_until,
  service_title_snapshot, service_price_snapshot, service_currency_snapshot,
  service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
  employee_name_snapshot, location_name_snapshot, created_by, updated_by
)
values
  (
    '98000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000001',
    'completed',
    now() - interval '2 day',
    now() - interval '2 day' + interval '60 minutes',
    now() - interval '2 day' - interval '10 minutes',
    now() - interval '2 day' + interval '70 minutes',
    'Facial A', 120, 'SGD', 60, 10, 10,
    'Inst L1', 'A-L1',
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000002'
  ),
  (
    '98000000-0000-0000-0000-000000000002',
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000002',
    '96000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000002',
    'completed',
    now() - interval '1 day',
    now() - interval '1 day' + interval '60 minutes',
    now() - interval '1 day' - interval '10 minutes',
    now() - interval '1 day' + interval '70 minutes',
    'Facial A', 120, 'SGD', 60, 10, 10,
    'Inst L2', 'A-L2',
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000002'
  ),
  (
    '98000000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    '96000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000001',
    'confirmed',
    now() + interval '1 day',
    now() + interval '1 day' + interval '60 minutes',
    now() + interval '1 day' - interval '10 minutes',
    now() + interval '1 day' + interval '70 minutes',
    'Facial A', 120, 'SGD', 60, 10, 10,
    'Inst L1', 'A-L1',
    '91000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000002'
  )
on conflict (id) do nothing;

do $$
declare
  v_claim jsonb;
  v_claim_replay jsonb;
  v_claim_conflict jsonb;
  v_token uuid;
  v_token_revise uuid;
  v_token_follow uuid;
  v_token_follow_update uuid;
  v_result jsonb;
  v_treatment_id uuid;
  v_follow_up_id uuid;
  v_sensitive_marker text := 'SENSITIVE-BODY-DO-NOT-AUDIT';
  v_pending_due_count integer;
  v_revision_count integer;
begin
  -- create treatment from completed appointment (frontdesk L1)
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment:create_from_appointment',
    'crm02-create-1',
    repeat('a', 64),
    300
  ) into v_claim;

  v_token := (v_claim->>'claimToken')::uuid;

  select public.crm02_create_or_link_treatment_from_appointment(
    '91000000-0000-0000-0000-000000000004',
    'frontdesk',
    null,
    '92000000-0000-0000-0000-000000000001',
    '98000000-0000-0000-0000-000000000001',
    null,
    'open',
    'initial_record',
    'initial summary',
    v_sensitive_marker,
    current_date - 1,
    '97000000-0000-0000-0000-000000000001',
    'follow this up',
    (v_claim->>'id')::uuid,
    v_token
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'expected treatment create ok, got %', v_result;
  end if;

  v_treatment_id := (v_result->>'treatmentId')::uuid;
  v_follow_up_id := (v_result->>'followUpId')::uuid;

  if v_treatment_id is null then
    raise exception 'expected treatmentId in create result';
  end if;

  -- idempotent replay must return completed snapshot and no duplicate treatment
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment:create_from_appointment',
    'crm02-create-1',
    repeat('a', 64),
    300
  ) into v_claim_replay;

  if (v_claim_replay->>'outcome') <> 'already_completed' then
    raise exception 'expected already_completed replay outcome, got %', v_claim_replay;
  end if;

  if (select count(*) from public.salon_treatments where appointment_id = '98000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'idempotent replay duplicated treatment row';
  end if;

  -- same key + different hash must conflict
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment:create_from_appointment',
    'crm02-create-1',
    repeat('b', 64),
    300
  ) into v_claim_conflict;

  if coalesce((v_claim_conflict->>'ok')::boolean, true) is true
     or (v_claim_conflict->>'outcome') <> 'hash_conflict' then
    raise exception 'expected hash_conflict on changed payload, got %', v_claim_conflict;
  end if;

  -- prerequisite: appointment must be completed
  begin
    select public.claim_business_idempotency_key(
      '92000000-0000-0000-0000-000000000001',
      'salon_treatment:create_from_appointment',
      'crm02-precondition-not-completed',
      repeat('p', 64),
      300
    ) into v_claim;

    perform public.crm02_create_or_link_treatment_from_appointment(
      '91000000-0000-0000-0000-000000000004',
      'frontdesk',
      null,
      '92000000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000003',
      null,
      'open',
      null,
      null,
      null,
      null,
      null,
      null,
      (v_claim->>'id')::uuid,
      (v_claim->>'claimToken')::uuid
    );
    raise exception 'expected completed-appointment precondition failure';
  exception when sqlstate '23514' then
    null;
  end;

  -- location boundary: L1 frontdesk cannot create L2 treatment
  begin
    select public.claim_business_idempotency_key(
      '92000000-0000-0000-0000-000000000001',
      'salon_treatment:create_from_appointment',
      'crm02-cross-location-frontdesk',
      repeat('q', 64),
      300
    ) into v_claim;

    perform public.crm02_create_or_link_treatment_from_appointment(
      '91000000-0000-0000-0000-000000000004',
      'frontdesk',
      null,
      '92000000-0000-0000-0000-000000000001',
      '98000000-0000-0000-0000-000000000002',
      null,
      'open',
      null,
      null,
      null,
      null,
      null,
      null,
      (v_claim->>'id')::uuid,
      (v_claim->>'claimToken')::uuid
    );
    raise exception 'expected cross-location boundary failure';
  exception when sqlstate '42501' then
    null;
  end;

  -- instructor can create own serviced treatment (L2 instructor on L2 appointment)
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment:create_from_appointment',
    'crm02-create-inst-l2',
    repeat('c', 64),
    300
  ) into v_claim;

  perform public.crm02_create_or_link_treatment_from_appointment(
    '91000000-0000-0000-0000-000000000006',
    'instructor',
    '97000000-0000-0000-0000-000000000002',
    '92000000-0000-0000-0000-000000000001',
    '98000000-0000-0000-0000-000000000002',
    null,
    'open',
    'inst_create',
    'summary',
    'inst-sensitive',
    null,
    null,
    null,
    (v_claim->>'id')::uuid,
    (v_claim->>'claimToken')::uuid
  );

  -- instructor boundary: L1 instructor cannot touch L2 treatment
  begin
    select public.claim_business_idempotency_key(
      '92000000-0000-0000-0000-000000000001',
      'salon_treatment:revise',
      'crm02-revise-forbidden',
      repeat('d', 64),
      300
    ) into v_claim;

    perform public.crm02_revise_treatment(
      '91000000-0000-0000-0000-000000000005',
      'instructor',
      '97000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000001',
      (select id from public.salon_treatments where appointment_id = '98000000-0000-0000-0000-000000000002' limit 1),
      'completed',
      'forbidden',
      'x',
      'y',
      (v_claim->>'id')::uuid,
      (v_claim->>'claimToken')::uuid
    );

    raise exception 'expected instructor cross-service boundary failure';
  exception when sqlstate '42501' then
    null;
  end;

  -- revision history and audit redaction
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment:revise',
    'crm02-revise-1',
    repeat('e', 64),
    300
  ) into v_claim;

  v_token_revise := (v_claim->>'claimToken')::uuid;

  select public.crm02_revise_treatment(
    '91000000-0000-0000-0000-000000000002',
    'manager',
    null,
    '92000000-0000-0000-0000-000000000001',
    v_treatment_id,
    'completed',
    'aftercare_update',
    'safe summary',
    v_sensitive_marker,
    (v_claim->>'id')::uuid,
    v_token_revise
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'expected treatment revision ok, got %', v_result;
  end if;

  select count(*) into v_revision_count
  from public.salon_treatment_revisions
  where treatment_id = v_treatment_id;

  if v_revision_count < 2 then
    raise exception 'expected revision history entries >= 2, got %', v_revision_count;
  end if;

  if exists (
    select 1
    from public.strong_audit_logs
    where studio_id = '92000000-0000-0000-0000-000000000001'
      and coalesce(after_state::text, '') like ('%' || v_sensitive_marker || '%')
  ) then
    raise exception 'sensitive treatment body leaked into strong_audit_logs';
  end if;

  -- follow-up create + due queue
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment_follow_up:upsert',
    'crm02-followup-1',
    repeat('f', 64),
    300
  ) into v_claim;

  v_token_follow := (v_claim->>'claimToken')::uuid;

  select public.crm02_upsert_treatment_follow_up(
    '91000000-0000-0000-0000-000000000002',
    'manager',
    null,
    '92000000-0000-0000-0000-000000000001',
    v_treatment_id,
    null,
    current_date + 2,
    '97000000-0000-0000-0000-000000000001',
    'pending',
    'upcoming follow-up',
    (v_claim->>'id')::uuid,
    v_token_follow
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'expected follow-up create ok, got %', v_result;
  end if;

  -- follow-up status update idempotent
  select public.claim_business_idempotency_key(
    '92000000-0000-0000-0000-000000000001',
    'salon_treatment_follow_up:upsert',
    'crm02-followup-update-1',
    repeat('g', 64),
    300
  ) into v_claim;

  v_token_follow_update := (v_claim->>'claimToken')::uuid;

  select public.crm02_upsert_treatment_follow_up(
    '91000000-0000-0000-0000-000000000002',
    'manager',
    null,
    '92000000-0000-0000-0000-000000000001',
    v_treatment_id,
    v_follow_up_id,
    current_date - 1,
    '97000000-0000-0000-0000-000000000001',
    'in_progress',
    'urgent callback',
    (v_claim->>'id')::uuid,
    v_token_follow_update
  ) into v_result;

  if coalesce((v_result->>'ok')::boolean, false) is false then
    raise exception 'expected follow-up update ok, got %', v_result;
  end if;

  select count(*) into v_pending_due_count
  from public.salon_treatment_follow_ups f
  where f.studio_id = '92000000-0000-0000-0000-000000000001'
    and f.status in ('pending', 'in_progress')
    and f.due_on <= current_date;

  if v_pending_due_count < 1 then
    raise exception 'expected due queue count >= 1, got %', v_pending_due_count;
  end if;

  -- cross studio boundary must fail
  begin
    select public.claim_business_idempotency_key(
      '92000000-0000-0000-0000-000000000002',
      'salon_treatment:create_from_appointment',
      'crm02-cross-studio',
      repeat('h', 64),
      300
    ) into v_claim;

    perform public.crm02_create_or_link_treatment_from_appointment(
      '91000000-0000-0000-0000-000000000002',
      'manager',
      null,
      '92000000-0000-0000-0000-000000000002',
      '98000000-0000-0000-0000-000000000001',
      null,
      'open',
      null,
      null,
      null,
      null,
      null,
      null,
      (v_claim->>'id')::uuid,
      (v_claim->>'claimToken')::uuid
    );

    raise exception 'expected cross-studio create failure';
  exception when sqlstate 'P0002' or sqlstate '42501' or sqlstate '23514' then
    null;
  end;
end
$$;

select 'crm02_treatment_follow_up_ok' as result;
