\set ON_ERROR_STOP on

truncate table
  public.salon_customer_access_audits,
  public.salon_customer_consents,
  public.salon_customer_health_profiles,
  public.salon_customer_preferences,
  public.business_idempotency_keys,
  public.strong_audit_logs,
  public.employee_locations,
  public.employees,
  public.salon_customers,
  public.staff_memberships,
  public.locations,
  public.studios,
  public.users
restart identity cascade;

insert into public.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', 'manager-a@example.com'),
  ('a0000000-0000-0000-0000-000000000003', 'frontdesk-a@example.com'),
  ('a0000000-0000-0000-0000-000000000004', 'instructor-a@example.com'),
  ('a0000000-0000-0000-0000-000000000005', 'owner-b@example.com'),
  ('a0000000-0000-0000-0000-000000000006', 'customer-shared@example.com'),
  ('a0000000-0000-0000-0000-000000000007', 'mixed-role-a@example.com')
on conflict (id) do nothing;

insert into public.studios (id, owner_id, contract_status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'active'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'active')
on conflict (id) do nothing;

insert into public.locations (id, studio_id, name, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'A-L1', true),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'A-L2', true),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'B-L1', true)
on conflict (id) do nothing;

insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', null, 'manager', true),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'frontdesk', true),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'instructor', true),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'manager', true),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'instructor', true)
on conflict (id) do nothing;

insert into public.employees (id, studio_id, user_id, display_name, employment_status, is_active) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'Inst A', 'active', true),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'Mixed Role A', 'active', true)
on conflict (id) do nothing;

insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active) values
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', true, true),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', true, true)
on conflict do nothing;

insert into public.salon_customers (id, studio_id, user_id, full_name, status, source) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'Customer Shared - Studio A', 'active', 'frontdesk'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 'Customer Shared - Studio B', 'active', 'frontdesk')
on conflict (id) do nothing;

-- 1) Preferences/Health must enforce same studio via (studio_id, salon_customer_id)
select public.upsert_salon_customer_preferences(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'pref services',
  '{}',
  '{}',
  '{}',
  'English',
  'Oil-free',
  'Quiet room',
  'email',
  'pref note',
  null,
  null
);

select public.upsert_salon_customer_health_profile(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'nuts',
  'ammonia',
  'Product X',
  'eczema',
  'pregnancy week 20',
  'laser contraindicated',
  true,
  current_date,
  'pending',
  now(),
  null,
  null
);

-- 2) Cross-studio actor/location/customer combinations rejected.
do $$
begin
  begin
    perform public.record_salon_customer_access_audit(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000003',
      'frontdesk',
      'health_view',
      'c0000000-0000-0000-0000-000000000003',
      null,
      '{}'::jsonb
    );
    raise exception 'expected cross-studio location guard to fail';
  exception when sqlstate '23514' then
    null;
  end;
end;
$$;

-- 2b) Mixed-location role alignment: L1 manager + L2 instructor must log/use exact scoped role.
do $$
declare
  v_instructor_audit_count int;
  v_manager_l1_count int;
begin
  perform public.record_salon_customer_access_audit(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000007',
    'instructor',
    'health_view',
    'c0000000-0000-0000-0000-000000000002',
    null,
    '{}'::jsonb
  );

  select count(*) into v_instructor_audit_count
  from public.salon_customer_access_audits
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and salon_customer_id = 'f0000000-0000-0000-0000-000000000001'
    and actor_id = 'a0000000-0000-0000-0000-000000000007'
    and actor_role = 'instructor'
    and location_id = 'c0000000-0000-0000-0000-000000000002';

  if v_instructor_audit_count <> 1 then
    raise exception 'expected exactly one instructor audit at L2 for mixed-role actor';
  end if;

  begin
    perform public.record_salon_customer_access_audit(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000007',
      'manager',
      'health_view',
      'c0000000-0000-0000-0000-000000000002',
      null,
      '{}'::jsonb
    );
    raise exception 'expected mismatched manager role at L2 to fail';
  exception when sqlstate '42501' then
    null;
  end;

  perform public.upsert_salon_customer_preferences(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000007',
    'manager',
    'L1 booking-only preferred service',
    '{}',
    '{}',
    '{}',
    'English',
    null,
    null,
    'email',
    null,
    null,
    'c0000000-0000-0000-0000-000000000001'
  );

  select count(*) into v_manager_l1_count
  from public.salon_customer_access_audits
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and salon_customer_id = 'f0000000-0000-0000-0000-000000000001'
    and actor_id = 'a0000000-0000-0000-0000-000000000007'
    and actor_role = 'manager'
    and action = 'preference_update'
    and location_id = 'c0000000-0000-0000-0000-000000000001';

  if v_manager_l1_count <> 1 then
    raise exception 'expected manager preference_update audit at L1 for mixed-role actor';
  end if;
end;
$$;

-- 3) Consent append-only + idempotency flow.
select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-1',
  'hash-a',
  300
) as claim_one \gset

select public.record_salon_customer_email_consent_idempotent(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'granted',
  'frontdesk',
  'email-consent-v1',
  (:'claim_one'::jsonb->>'id')::uuid,
  (:'claim_one'::jsonb->>'claimToken')::uuid,
  '{"capture":"ipad-sign"}'::jsonb,
  now() - interval '1 hour',
  'c0000000-0000-0000-0000-000000000001',
  'corr-1'
) as consent_grant;

select 1 / case when (
  select status
  from public.business_idempotency_keys
  where id = (:'claim_one'::jsonb->>'id')::uuid
) = 'completed' then 1 else 0 end as assert_atomic_completion;

-- replay with same key/hash should be already_completed and no duplicate insert.
select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-1',
  'hash-a',
  300
) as claim_replay \gset

select 1 / case when (:'claim_replay'::jsonb->>'outcome') = 'already_completed' then 1 else 0 end as assert_replay_completed;

select 1 / case when (
  select count(*)
  from public.salon_customer_consents
  where idempotency_key_id = (:'claim_one'::jsonb->>'id')::uuid
) = 1 then 1 else 0 end as assert_single_event_per_idempotency;

-- same key + different hash must be rejected.
select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-1',
  'hash-a-conflict',
  300
) as claim_hash_conflict \gset

select 1 / case when (:'claim_hash_conflict'::jsonb->>'outcome') = 'hash_conflict' then 1 else 0 end as assert_hash_conflict;

-- crash window simulation: event exists but idempotency key still processing.
select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-crash',
  'hash-crash',
  300
) as claim_crash \gset

select public.record_salon_customer_email_consent(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'granted',
  'frontdesk',
  'email-consent-crash-v1',
  '{"capture":"legacy-crash-window"}'::jsonb,
  now() - interval '30 minutes',
  'c0000000-0000-0000-0000-000000000001',
  'corr-crash-legacy',
  (:'claim_crash'::jsonb->>'id')::uuid,
  (:'claim_crash'::jsonb->>'claimToken')::uuid
) as consent_crash_legacy;

select 1 / case when (
  select status
  from public.business_idempotency_keys
  where id = (:'claim_crash'::jsonb->>'id')::uuid
) = 'processing' then 1 else 0 end as assert_crash_processing;

select id
from public.salon_customer_consents
where idempotency_key_id = (:'claim_crash'::jsonb->>'id')::uuid
limit 1 \gset

update public.business_idempotency_keys
set claimed_at = now() - interval '2 hours'
where id = (:'claim_crash'::jsonb->>'id')::uuid;

select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-crash',
  'hash-crash',
  1
) as claim_crash_recover \gset

select 1 / case when (:'claim_crash_recover'::jsonb->>'outcome') = 'claimed' then 1 else 0 end as assert_reclaim_claimed;

select public.record_salon_customer_email_consent_idempotent(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'granted',
  'frontdesk',
  'email-consent-crash-v1',
  (:'claim_crash_recover'::jsonb->>'id')::uuid,
  (:'claim_crash_recover'::jsonb->>'claimToken')::uuid,
  '{"capture":"recovery-call"}'::jsonb,
  now() - interval '20 minutes',
  'c0000000-0000-0000-0000-000000000001',
  'corr-crash-recover'
) as consent_crash_recovery \gset

select 1 / case when (:'consent_crash_recovery'::jsonb->>'eventId')::uuid = :'id'::uuid then 1 else 0 end as assert_recovery_event_reused;

select 1 / case when (
  select count(*)
  from public.salon_customer_consents
  where idempotency_key_id = (:'claim_crash'::jsonb->>'id')::uuid
) = 1 then 1 else 0 end as assert_crash_no_duplicate_events;

select 1 / case when (
  select count(*)
  from public.salon_customer_access_audits
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and salon_customer_id = 'f0000000-0000-0000-0000-000000000001'
    and action = 'consent_update'
    and metadata ->> 'textVersion' = 'email-consent-crash-v1'
) = 1 then 1 else 0 end as assert_crash_no_duplicate_access_audit;

select 1 / case when (
  select count(*)
  from public.strong_audit_logs
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and target_type = 'salon_customer_consents'
    and idempotency_key_id = (:'claim_crash'::jsonb->>'id')::uuid
) = 1 then 1 else 0 end as assert_crash_no_duplicate_strong_audit;

select 1 / case when (
  select status
  from public.business_idempotency_keys
  where id = (:'claim_crash'::jsonb->>'id')::uuid
) = 'completed' then 1 else 0 end as assert_crash_recovery_completed;

select public.claim_business_idempotency_key(
  'b0000000-0000-0000-0000-000000000001',
  'salon_customer_consent:email',
  'crm01-consent-key-crash',
  'hash-crash-conflict',
  300
) as claim_crash_hash_conflict \gset

select 1 / case when (:'claim_crash_hash_conflict'::jsonb->>'outcome') = 'hash_conflict' then 1 else 0 end as assert_crash_hash_conflict;

-- withdraw event
select public.record_salon_customer_email_consent(
  'b0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'manager',
  'withdrawn',
  'frontdesk',
  'email-consent-v1',
  '{}'::jsonb,
  now(),
  'c0000000-0000-0000-0000-000000000001',
  'corr-2',
  null,
  null
);

-- 4) Effective consent status should be withdrawn.
do $$
declare
  v_status text;
begin
  select c.status into v_status
  from public.salon_customer_consents c
  where c.studio_id = 'b0000000-0000-0000-0000-000000000001'
    and c.salon_customer_id = 'f0000000-0000-0000-0000-000000000001'
  order by c.occurred_at desc, c.created_at desc, c.id desc
  limit 1;

  if v_status <> 'withdrawn' then
    raise exception 'expected latest consent status withdrawn, got %', v_status;
  end if;
end;
$$;

-- 5) Append-only consent/access-audit cannot update/delete.
do $$
begin
  begin
    update public.salon_customer_consents set status = 'granted' where studio_id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'expected consent update to fail';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    delete from public.salon_customer_access_audits where studio_id = 'b0000000-0000-0000-0000-000000000001';
    raise exception 'expected access audit delete to fail';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

-- 6) successful sensitive view/write produce access audit and payload does not copy health body.
do $$
declare
  v_count int;
  v_has_leak boolean;
begin
  perform public.record_salon_customer_access_audit(
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'manager',
    'health_view',
    'c0000000-0000-0000-0000-000000000001',
    null,
    '{"safe":true}'::jsonb
  );

  select count(*) into v_count
  from public.salon_customer_access_audits
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and salon_customer_id = 'f0000000-0000-0000-0000-000000000001';

  if v_count < 1 then
    raise exception 'expected at least one access audit row';
  end if;

  select exists (
    select 1
    from public.salon_customer_access_audits a
    where a.metadata::text ilike '%nuts%'
       or a.metadata::text ilike '%eczema%'
       or a.metadata::text ilike '%laser contraindicated%'
  ) into v_has_leak;

  if v_has_leak then
    raise exception 'access audit metadata leaked health body';
  end if;
end;
$$;

-- 7) studio isolation for same user in two studios (both rows can exist independently).
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.salon_customers
  where user_id = 'a0000000-0000-0000-0000-000000000006';

  if v_count <> 2 then
    raise exception 'expected two studio-isolated customer rows for same user_id, got %', v_count;
  end if;
end;
$$;

-- 8) anon/authenticated cannot execute privileged RPC.
do $$
begin
  execute 'set local role authenticated';
  begin
    perform public.record_salon_customer_access_audit(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000002',
      'manager',
      'health_view',
      null,
      null,
      '{}'::jsonb
    );
    raise exception 'expected authenticated execute denial';
  exception when sqlstate '42501' then
    null;
  end;
  execute 'reset role';

  execute 'set local role anon';
  begin
    perform public.record_salon_customer_access_audit(
      'b0000000-0000-0000-0000-000000000001',
      'f0000000-0000-0000-0000-000000000001',
      'a0000000-0000-0000-0000-000000000002',
      'manager',
      'health_view',
      null,
      null,
      '{}'::jsonb
    );
    raise exception 'expected anon execute denial';
  exception when sqlstate '42501' then
    null;
  end;
  execute 'reset role';
end;
$$;

-- 9) strong audit exists for health mutation and does not include raw health text.
do $$
declare
  v_count int;
  v_has_health_leak boolean;
begin
  select count(*) into v_count
  from public.strong_audit_logs
  where studio_id = 'b0000000-0000-0000-0000-000000000001'
    and target_type in ('salon_customer_health_profiles', 'salon_customer_consents', 'salon_customer_preferences');

  if v_count < 3 then
    raise exception 'expected strong audit rows for sensitive mutations';
  end if;

  select exists (
    select 1
    from public.strong_audit_logs s
    where coalesce(s.after_state::text, '') ilike '%nuts%'
       or coalesce(s.after_state::text, '') ilike '%eczema%'
       or coalesce(s.after_state::text, '') ilike '%laser contraindicated%'
  ) into v_has_health_leak;

  if v_has_health_leak then
    raise exception 'strong audit leaked full health details';
  end if;
end;
$$;

select 'verify-crm01-sensitive-customer-data: ok' as result;
