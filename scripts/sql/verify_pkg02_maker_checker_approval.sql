-- verify_pkg02_maker_checker_approval.sql
-- Validates PKG-02 Maker-Checker approval skeleton:
--   1) draft -> submitted -> approved -> applied
--   2) manual_adjustment ledger write with idempotent replay
--   3) reject path
--   4) version conflict + role override checks + self-approval prohibition

set check_function_bodies = off;

DO $$
declare
  v_studio_id uuid := 'f1111111-1111-1111-1111-111111111111'::uuid;
  v_location_id uuid := 'f2222222-2222-2222-2222-222222222222'::uuid;
  v_owner_id uuid := 'f3333333-3333-3333-3333-333333333333'::uuid;
  v_maker_id uuid := 'f4444444-4444-4444-4444-444444444444'::uuid;
  v_checker_id uuid := 'f5555555-5555-5555-5555-555555555555'::uuid;
  v_client_user_id uuid := 'f6666666-6666-6666-6666-666666666666'::uuid;
  v_salon_customer_id uuid := 'f7777777-7777-7777-7777-777777777777'::uuid;
  v_package_id uuid := 'f8888888-8888-8888-8888-888888888888'::uuid;
  v_client_package_id uuid := 'f9999999-9999-9999-9999-999999999999'::uuid;

  v_flow_request_id uuid;
  v_reject_request_id uuid;
  v_create jsonb;
  v_submit jsonb;
  v_decide jsonb;
  v_apply_1 jsonb;
  v_apply_2 jsonb;
  v_ledger_id uuid;
  v_ledger_count integer;
  v_ledger_delta integer;
  v_status text;
  v_version integer;
  v_log_count integer;
  v_credits_left integer;
  v_error text;
begin
  insert into public.users (id, email)
  values
    (v_owner_id, 'owner+pkg02-approval@example.com'),
    (v_maker_id, 'maker+pkg02-approval@example.com'),
    (v_checker_id, 'checker+pkg02-approval@example.com'),
    (v_client_user_id, 'client+pkg02-approval@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, owner_id)
  values (v_studio_id, v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'PKG02 Approval Verify Location')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.staff_memberships (studio_id, user_id, location_id, role, is_active)
  values
    (v_studio_id, v_maker_id, null, 'frontdesk', true),
    (v_studio_id, v_checker_id, null, 'manager', true)
  on conflict do nothing;

  insert into public.salon_customers (
    id,
    studio_id,
    user_id,
    full_name,
    email,
    status,
    source
  )
  values (
    v_salon_customer_id,
    v_studio_id,
    v_client_user_id,
    'PKG02 Approval Client',
    'client+pkg02-approval@example.com',
    'active',
    'walk_in'
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        user_id = excluded.user_id,
        merged_into_id = null,
        email = excluded.email;

  insert into public.packages (
    id,
    studio_id,
    name,
    price,
    credits,
    expiry_days,
    is_active
  )
  values (
    v_package_id,
    v_studio_id,
    'PKG02 Approval Package',
    120,
    12,
    60,
    true
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        name = excluded.name,
        price = excluded.price,
        credits = excluded.credits,
        expiry_days = excluded.expiry_days,
        is_active = excluded.is_active;

  insert into public.client_packages (
    id,
    client_id,
    package_id,
    credits_left,
    expiry_date,
    package_name_snapshot,
    package_credits_snapshot,
    package_expiry_days_snapshot
  )
  values (
    v_client_package_id,
    v_client_user_id,
    v_package_id,
    10,
    now() + interval '60 days',
    'PKG02 Approval Package',
    12,
    60
  )
  on conflict (id) do update
    set client_id = excluded.client_id,
        package_id = excluded.package_id,
        credits_left = 10,
        expiry_date = excluded.expiry_date,
        package_name_snapshot = excluded.package_name_snapshot,
        package_credits_snapshot = excluded.package_credits_snapshot,
        package_expiry_days_snapshot = excluded.package_expiry_days_snapshot;

  delete from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and source_type = 'pkg02_adjustment_request';

  delete from public.pkg02_approval_logs
  where studio_id = v_studio_id;

  delete from public.pkg02_adjustment_requests
  where studio_id = v_studio_id;

  update public.client_packages
  set credits_left = 10
  where id = v_client_package_id;

  v_create := public.pkg02_create_adjustment_request(
    p_actor_id := v_maker_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_client_package_id := v_client_package_id,
    p_requested_delta_credits := -2,
    p_reason := 'manual correction debit',
    p_requested_value_delta_amount := -20,
    p_currency := 'SGD',
    p_location_id := v_location_id,
    p_salon_customer_id := v_salon_customer_id,
    p_metadata := jsonb_build_object('verify', 'pkg02')
  );

  if coalesce((v_create->>'ok')::boolean, false) is false then
    raise exception 'PKG-02 approval verify create failed: %', v_create;
  end if;

  v_flow_request_id := (v_create->>'request_id')::uuid;

  v_submit := public.pkg02_submit_adjustment_request(
    p_actor_id := v_maker_id,
    p_actor_role := 'frontdesk',
    p_studio_id := v_studio_id,
    p_request_id := v_flow_request_id,
    p_expected_version := 1,
    p_note := 'submit for checker'
  );

  if coalesce((v_submit->>'ok')::boolean, false) is false
     or coalesce(v_submit->>'status', '') <> 'submitted' then
    raise exception 'PKG-02 approval verify submit failed: %', v_submit;
  end if;

  begin
    perform public.pkg02_decide_adjustment_request(
      p_actor_id := v_maker_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_request_id := v_flow_request_id,
      p_decision := 'approved',
      p_expected_version := 2,
      p_note := 'maker self approval should fail'
    );
    raise exception 'PKG-02 approval verify expected maker self-approval to fail';
  exception
    when others then
      v_error := sqlerrm;
      if position('self-approve' in lower(v_error)) = 0
         and position('checker role' in lower(v_error)) = 0 then
        raise;
      end if;
  end;

  v_decide := public.pkg02_decide_adjustment_request(
    p_actor_id := v_checker_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_request_id := v_flow_request_id,
    p_decision := 'approved',
    p_expected_version := 2,
    p_note := 'checker approved'
  );

  if coalesce((v_decide->>'ok')::boolean, false) is false
     or coalesce(v_decide->>'status', '') <> 'approved' then
    raise exception 'PKG-02 approval verify approval failed: %', v_decide;
  end if;

  begin
    perform public.pkg02_submit_adjustment_request(
      p_actor_id := v_maker_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_request_id := v_flow_request_id,
      p_expected_version := 1,
      p_note := 'stale resubmit should fail'
    );
    raise exception 'PKG-02 approval verify expected stale submit to fail';
  exception
    when others then
      v_error := sqlerrm;
      if position('cannot be submitted' in lower(v_error)) = 0
         and position('version conflict' in lower(v_error)) = 0 then
        raise;
      end if;
  end;

  v_apply_1 := public.pkg02_apply_adjustment_request(
    p_actor_id := v_checker_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_request_id := v_flow_request_id,
    p_idempotency_key := 'pkg02-approval-apply-1',
    p_request_hash := 'pkg02-approval-apply-hash-1',
    p_expected_version := 3,
    p_note := 'apply approved request',
    p_correlation_id := 'pkg02-approval-verify-flow-1'
  );

  if coalesce((v_apply_1->>'ok')::boolean, false) is false
     or coalesce(v_apply_1->>'status', '') <> 'applied' then
    raise exception 'PKG-02 approval verify apply failed: %', v_apply_1;
  end if;

  v_ledger_id := (v_apply_1->>'ledger_entry_id')::uuid;

  v_apply_2 := public.pkg02_apply_adjustment_request(
    p_actor_id := v_checker_id,
    p_actor_role := 'manager',
    p_studio_id := v_studio_id,
    p_request_id := v_flow_request_id,
    p_idempotency_key := 'pkg02-approval-apply-1',
    p_request_hash := 'pkg02-approval-apply-hash-1',
    p_expected_version := null,
    p_note := 'apply replay',
    p_correlation_id := 'pkg02-approval-verify-flow-1-replay'
  );

  if coalesce((v_apply_2->>'ok')::boolean, false) is false
     or (v_apply_2->>'ledger_entry_id')::uuid is distinct from v_ledger_id then
    raise exception 'PKG-02 approval verify apply replay mismatch: %', v_apply_2;
  end if;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_ledger_count, v_ledger_delta
  from public.client_package_ledger_entries le
  where le.studio_id = v_studio_id
    and le.source_type = 'pkg02_adjustment_request'
    and le.source_id = v_flow_request_id
    and le.event_type = 'manual_adjustment';

  if v_ledger_count <> 1 or v_ledger_delta <> -2 then
    raise exception 'PKG-02 approval verify ledger mismatch count=% delta=%', v_ledger_count, v_ledger_delta;
  end if;

  select status, version
  into v_status, v_version
  from public.pkg02_adjustment_requests r
  where r.id = v_flow_request_id;

  if v_status <> 'applied' or v_version <> 4 then
    raise exception 'PKG-02 approval verify request final state mismatch: status=% version=%', v_status, v_version;
  end if;

  select credits_left
  into v_credits_left
  from public.client_packages
  where id = v_client_package_id;

  if v_credits_left <> 8 then
    raise exception 'PKG-02 approval verify expected client package credits_left=8, got %', v_credits_left;
  end if;

  select count(*)
  into v_log_count
  from public.pkg02_approval_logs l
  where l.request_id = v_flow_request_id;

  if v_log_count <> 4 then
    raise exception 'PKG-02 approval verify expected 4 approval logs for happy path, got %', v_log_count;
  end if;

  begin
    v_create := public.pkg02_create_adjustment_request(
      p_actor_id := v_maker_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_client_package_id := v_client_package_id,
      p_requested_delta_credits := -1,
      p_reason := 'reject path test',
      p_requested_value_delta_amount := -10,
      p_currency := 'SGD',
      p_location_id := v_location_id,
      p_salon_customer_id := v_salon_customer_id,
      p_metadata := '{}'::jsonb
    );

    v_reject_request_id := (v_create->>'request_id')::uuid;

    perform public.pkg02_submit_adjustment_request(
      p_actor_id := v_maker_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_request_id := v_reject_request_id,
      p_expected_version := 1,
      p_note := 'submit reject path'
    );

    perform public.pkg02_decide_adjustment_request(
      p_actor_id := v_checker_id,
      p_actor_role := 'manager',
      p_studio_id := v_studio_id,
      p_request_id := v_reject_request_id,
      p_decision := 'rejected',
      p_expected_version := 2,
      p_rejection_reason := 'insufficient evidence',
      p_note := 'checker rejected'
    );
  exception
    when others then
      raise exception 'PKG-02 approval verify reject path failed: %', sqlerrm;
  end;

  select status, version
  into v_status, v_version
  from public.pkg02_adjustment_requests r
  where r.id = v_reject_request_id;

  if v_status <> 'rejected' or v_version <> 3 then
    raise exception 'PKG-02 approval verify reject state mismatch: status=% version=%', v_status, v_version;
  end if;

  begin
    perform public.pkg02_decide_adjustment_request(
      p_actor_id := v_maker_id,
      p_actor_role := 'frontdesk',
      p_studio_id := v_studio_id,
      p_request_id := v_reject_request_id,
      p_decision := 'approved',
      p_expected_version := 3,
      p_note := 'frontdesk checker should fail'
    );
    raise exception 'PKG-02 approval verify expected frontdesk checker override to fail';
  exception
    when others then
      v_error := sqlerrm;
      if position('checker role' in lower(v_error)) = 0
         and position('invalid actor role' in lower(v_error)) = 0 then
        raise;
      end if;
  end;

  raise notice 'verify_pkg02_maker_checker_approval: ok';
end;
$$;
