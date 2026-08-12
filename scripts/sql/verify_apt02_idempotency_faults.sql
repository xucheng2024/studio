\set ON_ERROR_STOP on

select set_config('apt02.idempotency_run_id', :'run_id', false);

DO $$
declare
  v_run_id text := current_setting('apt02.idempotency_run_id');
  v_key_create text := 'apt02-idem-create-' || v_run_id;
  v_key_conflict text := 'apt02-idem-conflict-' || v_run_id;
  v_key_stale text := 'apt02-idem-stale-' || v_run_id;
  v_payload_create jsonb;
  v_request_hash_create text;
  v_claim_create jsonb;
  v_result_create jsonb;
  v_claim_create_replay jsonb;

  v_payload_conflict jsonb;
  v_request_hash_conflict text;
  v_claim_conflict jsonb;
  v_fail_conflict jsonb;
  v_claim_conflict_retry jsonb;

  v_payload_stale jsonb;
  v_request_hash_stale text;
  v_claim_stale_1 jsonb;
  v_claim_stale_2 jsonb;
  v_complete_old jsonb;
  v_fail_old jsonb;

  v_new_token uuid;
  v_old_token uuid;
  v_status text;
begin
  -- base payload for same-key/same-hash replay test
  v_payload_create := jsonb_build_object(
    'studioId', '11111111-1111-1111-1111-111111111111',
    'locationId', '21111111-1111-1111-1111-111111111111',
    'salonCustomerId', '41111111-1111-1111-1111-111111111111',
    'serviceId', '31111111-1111-1111-1111-111111111111',
    'employeeId', '51111111-1111-1111-1111-111111111111',
    'startsAtIso', '2026-08-17T07:00:00.000Z',
    'resourceIds', jsonb_build_array(
      '61111111-1111-1111-1111-111111111111',
      '61222222-2222-2222-2222-222222222222'
    ),
    'idempotencyKey', v_key_create
  );

  select encode(digest(convert_to(v_payload_create::text, 'utf8'), 'sha256'), 'hex') into v_request_hash_create;

  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_create,
    v_request_hash_create,
    300
  ) into v_claim_create;

  if (v_claim_create->>'outcome') <> 'claimed' then
    raise exception 'expected first create claim outcome=claimed, got %', v_claim_create;
  end if;

  -- success path (simulate response lost by ignoring this variable externally)
  select public.create_salon_appointment(
    '91111111-1111-1111-1111-111111111111',
    'owner',
    '11111111-1111-1111-1111-111111111111',
    '21111111-1111-1111-1111-111111111111',
    '41111111-1111-1111-1111-111111111111',
    '31111111-1111-1111-1111-111111111111',
    '51111111-1111-1111-1111-111111111111',
    '2026-08-17 07:00:00+00',
    array['61111111-1111-1111-1111-111111111111'::uuid, '61222222-2222-2222-2222-222222222222'::uuid],
    null,
    null,
    null,
    null,
    null,
    null,
    'APT02-IDEM-CREATE-' || v_run_id,
    (v_claim_create->>'id')::uuid,
    (v_claim_create->>'claimToken')::uuid
  ) into v_result_create;

  -- same key + same hash must replay completed snapshot
  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_create,
    v_request_hash_create,
    300
  ) into v_claim_create_replay;

  if (v_claim_create_replay->>'outcome') <> 'already_completed' then
    raise exception 'expected replay outcome=already_completed, got %', v_claim_create_replay;
  end if;

  if (v_claim_create_replay->'result') is null then
    raise exception 'expected replay result snapshot to be present';
  end if;

  if (v_claim_create_replay->'result') <> v_result_create then
    raise exception 'expected replay result snapshot to match original result';
  end if;

  -- conflict path: after business conflict, claim should be markable failed (not stuck processing)
  v_payload_conflict := jsonb_build_object(
    'idempotencyKey', v_key_conflict,
    'startsAtIso', '2026-08-17T07:00:00.000Z'
  );
  select encode(digest(convert_to(v_payload_conflict::text, 'utf8'), 'sha256'), 'hex') into v_request_hash_conflict;

  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_conflict,
    v_request_hash_conflict,
    300
  ) into v_claim_conflict;

  begin
    perform public.create_salon_appointment(
      '91111111-1111-1111-1111-111111111111',
      'owner',
      '11111111-1111-1111-1111-111111111111',
      '21111111-1111-1111-1111-111111111111',
      '41111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111',
      '52222222-2222-2222-2222-222222222222',
      '2026-08-17 07:00:00+00',
      array['61111111-1111-1111-1111-111111111111'::uuid, '61222222-2222-2222-2222-222222222222'::uuid],
      null,
      null,
      null,
      null,
      null,
      null,
      'APT02-IDEM-CONFLICT-' || v_run_id,
      (v_claim_conflict->>'id')::uuid,
      (v_claim_conflict->>'claimToken')::uuid
    );
    raise exception 'expected create conflict to fail';
  exception when sqlstate '23P01' then
    null;
  end;

  select public.fail_business_idempotency_key(
    (v_claim_conflict->>'id')::uuid,
    (v_claim_conflict->>'claimToken')::uuid,
    'slot_conflict: exclusion violation',
    true
  ) into v_fail_conflict;

  if coalesce((v_fail_conflict->>'ok')::boolean, false) is distinct from true then
    raise exception 'expected fail_business_idempotency_key ok=true, got %', v_fail_conflict;
  end if;

  select status into v_status
  from public.business_idempotency_keys
  where id = (v_claim_conflict->>'id')::uuid;

  if v_status <> 'failed' then
    raise exception 'expected conflict claim status=failed, got %', v_status;
  end if;

  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_conflict,
    v_request_hash_conflict,
    300
  ) into v_claim_conflict_retry;

  if (v_claim_conflict_retry->>'outcome') <> 'claimed' then
    raise exception 'expected failed claim to be reclaimable, got %', v_claim_conflict_retry;
  end if;

  -- stale token fencing: old token cannot complete/fail after reclaim
  v_payload_stale := jsonb_build_object('idempotencyKey', v_key_stale);
  select encode(digest(convert_to(v_payload_stale::text, 'utf8'), 'sha256'), 'hex') into v_request_hash_stale;

  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_stale,
    v_request_hash_stale,
    300
  ) into v_claim_stale_1;

  v_old_token := (v_claim_stale_1->>'claimToken')::uuid;

  update public.business_idempotency_keys
  set claimed_at = now() - interval '10 minutes'
  where id = (v_claim_stale_1->>'id')::uuid;

  select public.claim_business_idempotency_key(
    '11111111-1111-1111-1111-111111111111',
    'salon_appointment:create',
    v_key_stale,
    v_request_hash_stale,
    1
  ) into v_claim_stale_2;

  if (v_claim_stale_2->>'outcome') <> 'claimed' then
    raise exception 'expected stale claim to be reclaimed, got %', v_claim_stale_2;
  end if;

  v_new_token := (v_claim_stale_2->>'claimToken')::uuid;
  if v_new_token = v_old_token then
    raise exception 'expected reclaimed claim token to differ from stale token';
  end if;

  select public.complete_business_idempotency_key(
    (v_claim_stale_2->>'id')::uuid,
    v_old_token,
    jsonb_build_object('ok', true)
  ) into v_complete_old;

  if coalesce((v_complete_old->>'ok')::boolean, false) is distinct from false then
    raise exception 'expected stale token complete to fail, got %', v_complete_old;
  end if;

  select public.fail_business_idempotency_key(
    (v_claim_stale_2->>'id')::uuid,
    v_old_token,
    'stale_token',
    true
  ) into v_fail_old;

  if coalesce((v_fail_old->>'ok')::boolean, false) is distinct from false then
    raise exception 'expected stale token fail to return ok=false, got %', v_fail_old;
  end if;
end
$$;

select 'apt02_idempotency_fault_injection_ok' as result;
