-- Verifies APT-05 queue behavior:
--   * enqueue dedupe
--   * claim/complete/fail fencing + retry scheduling
--   * reschedule/cancel invalidates stale reminders
--   * missing recipient email is invalidated immediately

do $$
declare
  v_studio_id uuid := '00000000-0000-0000-0000-00000000a501';
  v_location_id uuid := '00000000-0000-0000-0000-00000000a502';
  v_customer_id uuid := '00000000-0000-0000-0000-00000000a503';
  v_customer2_id uuid := '00000000-0000-0000-0000-00000000a504';
  v_service_id uuid := '00000000-0000-0000-0000-00000000a505';
  v_employee_id uuid := '00000000-0000-0000-0000-00000000a506';
  v_appointment_id uuid := '00000000-0000-0000-0000-00000000a507';
  v_appointment2_id uuid := '00000000-0000-0000-0000-00000000a508';
  v_user_id uuid := '00000000-0000-0000-0000-00000000a509';
  v_job_id uuid;
  v_claim_token uuid;
  v_claimed_count integer;
  v_total integer;
  v_status text;
  v_attempt_count integer;
  v_invalidated_reason text;
  v_next_attempt timestamptz;
  v_result jsonb;
begin
  insert into public.users (id, email)
  values (v_user_id, 'apt05-actor@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id)
  values (v_studio_id)
  on conflict (id) do nothing;

  insert into public.locations (id, studio_id, name, is_active)
  values (v_location_id, v_studio_id, 'APT05 Location', true)
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.studio_services (
    id, studio_id, name, price, currency, is_active,
    default_duration_minutes, default_prep_minutes, default_buffer_minutes
  )
  values (
    v_service_id, v_studio_id, 'APT05 Service', 88, 'SGD', true,
    60, 0, 0
  )
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.employees (id, studio_id, display_name, employment_status, is_active)
  values (v_employee_id, v_studio_id, 'APT05 Therapist', 'active', true)
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
  values (v_employee_id, v_location_id, v_studio_id, true)
  on conflict do nothing;

  insert into public.service_locations (
    studio_id, service_id, location_id, is_enabled, uses_default_values,
    duration_override_minutes, buffer_override_minutes
  )
  values (v_studio_id, v_service_id, v_location_id, true, true, null, null)
  on conflict (service_id, location_id) do update set studio_id = excluded.studio_id;

  insert into public.service_employees (studio_id, service_id, employee_id, is_active)
  values (v_studio_id, v_service_id, v_employee_id, true)
  on conflict (service_id, employee_id) do update set studio_id = excluded.studio_id;

  insert into public.salon_customers (id, studio_id, full_name, email, status, source)
  values (v_customer_id, v_studio_id, 'APT05 Customer', 'apt05.customer@example.com', 'active', 'frontdesk')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.salon_customers (id, studio_id, full_name, email, status, source)
  values (v_customer2_id, v_studio_id, 'APT05 NoEmail Customer', null, 'active', 'frontdesk')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id,
    status, starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot
  ) values (
    v_appointment_id, v_studio_id, v_location_id, v_customer_id, v_service_id, v_employee_id,
    'confirmed', now() + interval '2 day', now() + interval '2 day 1 hour',
    now() + interval '2 day', now() + interval '2 day 1 hour',
    'APT05 Service', 88, 'SGD', 60, 0, 0,
    'APT05 Therapist', 'APT05 Location'
  ) on conflict (id) do update set salon_customer_id = excluded.salon_customer_id;

  insert into public.salon_appointments (
    id, studio_id, location_id, salon_customer_id, service_id, employee_id,
    status, starts_at, ends_at, occupied_from, occupied_until,
    service_title_snapshot, service_price_snapshot, service_currency_snapshot,
    service_duration_snapshot_minutes, prep_snapshot_minutes, buffer_snapshot_minutes,
    employee_name_snapshot, location_name_snapshot
  ) values (
    v_appointment2_id, v_studio_id, v_location_id, v_customer2_id, v_service_id, v_employee_id,
    'confirmed', now() + interval '3 day', now() + interval '3 day 1 hour',
    now() + interval '3 day', now() + interval '3 day 1 hour',
    'APT05 Service', 88, 'SGD', 60, 0, 0,
    'APT05 Therapist', 'APT05 Location'
  ) on conflict (id) do update set salon_customer_id = excluded.salon_customer_id;

  delete from public.appointment_notification_queue
  where studio_id = v_studio_id;

  -- enqueue + dedupe
  v_result := public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment_id,
    p_event_type := 'appointment_created',
    p_dedupe_key := 'apt05:dedupe:create:1',
    p_actor_id := v_user_id,
    p_actor_role := 'manager'
  );

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'enqueue create expected ok=true: %', v_result;
  end if;

  v_result := public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment_id,
    p_event_type := 'appointment_created',
    p_dedupe_key := 'apt05:dedupe:create:1',
    p_actor_id := v_user_id,
    p_actor_role := 'manager'
  );

  if coalesce((v_result ->> 'deduped')::boolean, false) is distinct from true then
    raise exception 'second enqueue must be deduped: %', v_result;
  end if;

  select count(*)::integer into v_total
  from public.appointment_notification_queue
  where dedupe_key = 'apt05:dedupe:create:1';

  if v_total <> 1 then
    raise exception 'dedupe expected 1 row, got %', v_total;
  end if;

  -- claim and retry failure
  select count(*)::integer into v_claimed_count
  from public.claim_appointment_notification_email_jobs(1, 'verify-apt05', 300);

  if v_claimed_count <> 1 then
    raise exception 'expected 1 claimed row, got %', v_claimed_count;
  end if;

  select id, claim_token
  into v_job_id, v_claim_token
  from public.appointment_notification_queue
  where dedupe_key = 'apt05:dedupe:create:1';

  v_result := public.fail_appointment_notification_email_job(
    p_job_id := v_job_id,
    p_claim_token := v_claim_token,
    p_error_summary := 'transient provider timeout',
    p_retryable := true,
    p_base_delay_seconds := 3,
    p_max_delay_seconds := 60
  );

  if (v_result ->> 'status') <> 'pending' then
    raise exception 'retryable fail must go back to pending, got %', v_result;
  end if;

  select status, attempt_count, next_attempt_at
  into v_status, v_attempt_count, v_next_attempt
  from public.appointment_notification_queue
  where id = v_job_id;

  if v_status <> 'pending' or v_attempt_count <> 1 or v_next_attempt <= now() then
    raise exception 'unexpected retry state status=% attempt_count=% next_attempt_at=%', v_status, v_attempt_count, v_next_attempt;
  end if;

  update public.appointment_notification_queue
  set next_attempt_at = now() - interval '1 second'
  where id = v_job_id;

  -- claim again and complete
  select count(*)::integer into v_claimed_count
  from public.claim_appointment_notification_email_jobs(1, 'verify-apt05-2', 300);

  if v_claimed_count <> 1 then
    raise exception 'expected claimed row on retry, got %', v_claimed_count;
  end if;

  select claim_token into v_claim_token
  from public.appointment_notification_queue
  where id = v_job_id;

  v_result := public.complete_appointment_notification_email_job(
    p_job_id := v_job_id,
    p_claim_token := v_claim_token,
    p_delivery_meta := jsonb_build_object('provider', 'test')
  );

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'complete expected ok=true: %', v_result;
  end if;

  select status into v_status
  from public.appointment_notification_queue
  where id = v_job_id;

  if v_status <> 'sent' then
    raise exception 'expected sent status after complete, got %', v_status;
  end if;

  -- manual retry: fail non-retryable first, then force back to pending via ops RPC
  perform public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment_id,
    p_event_type := 'appointment_confirmed',
    p_dedupe_key := 'apt05:manual-retry:1'
  );

  select count(*)::integer into v_claimed_count
  from public.claim_appointment_notification_email_jobs(1, 'verify-apt05-manual', 300);

  select id, claim_token
  into v_job_id, v_claim_token
  from public.appointment_notification_queue
  where dedupe_key = 'apt05:manual-retry:1';

  v_result := public.fail_appointment_notification_email_job(
    p_job_id := v_job_id,
    p_claim_token := v_claim_token,
    p_error_summary := 'hard fail for manual retry test',
    p_retryable := false,
    p_base_delay_seconds := 3,
    p_max_delay_seconds := 60
  );

  if (v_result ->> 'status') <> 'failed' then
    raise exception 'non-retryable fail must be failed, got %', v_result;
  end if;

  v_result := public.retry_appointment_notification_email_job(
    p_job_id := v_job_id,
    p_actor_id := v_user_id,
    p_actor_role := 'manager'
  );

  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'manual retry expected ok=true: %', v_result;
  end if;

  select status, next_attempt_at
  into v_status, v_next_attempt
  from public.appointment_notification_queue
  where id = v_job_id;

  if v_status <> 'pending' or v_next_attempt > now() + interval '2 seconds' then
    raise exception 'manual retry mismatch status=% next_attempt_at=%', v_status, v_next_attempt;
  end if;

  -- reminder invalidation when rescheduled
  perform public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment_id,
    p_event_type := 'appointment_reminder_24h',
    p_dedupe_key := 'apt05:reminder:1',
    p_scheduled_for := now() + interval '1 day'
  );

  perform public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment_id,
    p_event_type := 'appointment_rescheduled',
    p_dedupe_key := 'apt05:reschedule:1'
  );

  select status, invalidation_reason
  into v_status, v_invalidated_reason
  from public.appointment_notification_queue
  where dedupe_key = 'apt05:reminder:1';

  if v_status <> 'invalidated' or v_invalidated_reason <> 'stale_after_reschedule_or_cancel' then
    raise exception 'reminder invalidation mismatch status=% reason=%', v_status, v_invalidated_reason;
  end if;

  -- missing recipient email -> invalidated row
  perform public.enqueue_appointment_notification_email(
    p_studio_id := v_studio_id,
    p_appointment_id := v_appointment2_id,
    p_event_type := 'appointment_created',
    p_dedupe_key := 'apt05:noemail:1'
  );

  select status, invalidation_reason
  into v_status, v_invalidated_reason
  from public.appointment_notification_queue
  where dedupe_key = 'apt05:noemail:1';

  if v_status <> 'invalidated' or v_invalidated_reason <> 'missing_recipient_email' then
    raise exception 'missing-email invalidation mismatch status=% reason=%', v_status, v_invalidated_reason;
  end if;

  raise notice 'apt05_notification_queue_verification_ok';
end;
$$;
