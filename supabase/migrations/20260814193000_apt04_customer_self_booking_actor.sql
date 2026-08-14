-- APT-04 Phase 1: allow customer actor on APT-02 create/reschedule/cancel
-- while preserving staff contract and enforcing strict "self-only" mutation.

create or replace function public.assert_salon_appointment_actor_role(p_actor_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_actor_role not in ('owner', 'manager', 'frontdesk', 'customer') then
    raise exception 'appointment mutation role % is not allowed', p_actor_role using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_salon_customer_actor(
  p_studio_id uuid,
  p_actor_id uuid,
  p_salon_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer record;
begin
  select id, studio_id, user_id, merged_into_id, status
  into v_customer
  from public.salon_customers
  where id = p_salon_customer_id
  for update;

  if not found then
    raise exception 'customer % not found', p_salon_customer_id using errcode = 'P0002';
  end if;

  if v_customer.studio_id <> p_studio_id then
    raise exception 'customer % does not belong to studio %', p_salon_customer_id, p_studio_id using errcode = '42501';
  end if;

  if v_customer.user_id is null or v_customer.user_id <> p_actor_id then
    raise exception 'customer actor % does not own salon customer %', p_actor_id, p_salon_customer_id using errcode = '42501';
  end if;

  if v_customer.merged_into_id is not null then
    raise exception 'customer % has been merged and cannot mutate appointments', p_salon_customer_id using errcode = '42501';
  end if;

  if coalesce(v_customer.status, 'active') <> 'active' then
    raise exception 'customer % is not active', p_salon_customer_id using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_salon_customer_id uuid,
  p_service_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_resource_ids uuid[] default null,
  p_terms_version_id uuid default null,
  p_terms_accepted_at timestamptz default null,
  p_terms_acceptance_channel text default null,
  p_terms_acceptance_method text default null,
  p_terms_recorded_by uuid default null,
  p_expires_at timestamptz default null,
  p_internal_note text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_timing record;
  v_employee record;
  v_appointment public.salon_appointments%rowtype;
  v_ends_at timestamptz;
  v_occupied_from timestamptz;
  v_occupied_until timestamptz;
  v_expires_at timestamptz;
  v_terms record;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
begin
  v_idempotency_enabled := p_idempotency_key_id is not null or p_idempotency_claim_token is not null;
  if v_idempotency_enabled then
    if p_idempotency_key_id is null or p_idempotency_claim_token is null then
      raise exception 'both idempotency_key_id and claim_token are required together' using errcode = '23514';
    end if;
    perform public.assert_business_idempotency_claim_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_studio_id := p_studio_id,
      p_operation_scope := 'salon_appointment:create'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  if p_actor_role = 'customer' then
    perform public.assert_salon_customer_actor(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_salon_customer_id := p_salon_customer_id
    );
  end if;

  if p_starts_at is null then
    raise exception 'starts_at is required' using errcode = '23514';
  end if;

  select * into v_timing
  from public.get_effective_service_timing_for_appointment(p_studio_id, p_service_id, p_location_id);

  v_ends_at := p_starts_at + make_interval(mins => v_timing.duration_minutes);
  v_occupied_from := p_starts_at - make_interval(mins => v_timing.prep_minutes);
  v_occupied_until := v_ends_at + make_interval(mins => v_timing.buffer_minutes);
  v_expires_at := coalesce(p_expires_at, now() + interval '15 minutes');

  select id, display_name
  into v_employee
  from public.employees
  where id = p_employee_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'employee % not found in studio %', p_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  perform public.assert_employee_available_for_appointment(
    p_studio_id,
    p_location_id,
    p_service_id,
    p_employee_id,
    v_occupied_from,
    v_occupied_until
  );

  perform * from public.assert_resources_valid_for_appointment(
    p_studio_id,
    p_location_id,
    p_service_id,
    p_resource_ids
  );

  insert into public.salon_appointments (
    studio_id,
    location_id,
    salon_customer_id,
    service_id,
    employee_id,
    status,
    starts_at,
    ends_at,
    occupied_from,
    occupied_until,
    expires_at,
    internal_note,
    service_title_snapshot,
    service_price_snapshot,
    service_currency_snapshot,
    service_duration_snapshot_minutes,
    prep_snapshot_minutes,
    buffer_snapshot_minutes,
    employee_name_snapshot,
    location_name_snapshot,
    created_by,
    updated_by
  )
  values (
    p_studio_id,
    p_location_id,
    p_salon_customer_id,
    p_service_id,
    p_employee_id,
    'pending',
    p_starts_at,
    v_ends_at,
    v_occupied_from,
    v_occupied_until,
    v_expires_at,
    p_internal_note,
    v_timing.service_title,
    v_timing.service_price,
    v_timing.service_currency,
    v_timing.duration_minutes,
    v_timing.prep_minutes,
    v_timing.buffer_minutes,
    v_employee.display_name,
    v_timing.location_name,
    p_actor_id,
    p_actor_id
  )
  returning * into v_appointment;

  insert into public.salon_appointment_resources (
    appointment_id,
    resource_id,
    studio_id,
    location_id,
    occupied_from,
    occupied_until,
    is_active,
    released_at
  )
  select
    v_appointment.id,
    rv.resource_id,
    p_studio_id,
    p_location_id,
    v_occupied_from,
    v_occupied_until,
    true,
    null
  from public.assert_resources_valid_for_appointment(p_studio_id, p_location_id, p_service_id, p_resource_ids) rv;

  insert into public.salon_appointment_status_history (
    appointment_id,
    studio_id,
    from_status,
    to_status,
    actor,
    actor_id,
    actor_role,
    reason
  )
  values (
    v_appointment.id,
    p_studio_id,
    null,
    'pending',
    'user',
    p_actor_id,
    p_actor_role,
    'created'
  );

  if p_terms_version_id is not null then
    if p_terms_accepted_at is null then
      raise exception 'terms_accepted_at is required when terms_version_id is provided' using errcode = '23514';
    end if;
    if p_terms_acceptance_channel is null or btrim(p_terms_acceptance_channel) = '' then
      raise exception 'terms_acceptance_channel is required when terms_version_id is provided' using errcode = '23514';
    end if;
    if p_terms_acceptance_method is null or btrim(p_terms_acceptance_method) = '' then
      raise exception 'terms_acceptance_method is required when terms_version_id is provided' using errcode = '23514';
    end if;

    select id, studio_id, version_label, content_hash
    into v_terms
    from public.salon_terms_versions
    where id = p_terms_version_id
    for update;

    if not found or v_terms.studio_id <> p_studio_id then
      raise exception 'terms version % not found in studio %', p_terms_version_id, p_studio_id using errcode = '23514';
    end if;

    insert into public.salon_terms_acceptances (
      studio_id,
      terms_version_id,
      appointment_id,
      salon_customer_id,
      accepted_at,
      acceptance_channel,
      acceptance_method,
      recorded_by,
      content_hash_snapshot,
      version_label_snapshot
    )
    values (
      p_studio_id,
      p_terms_version_id,
      v_appointment.id,
      p_salon_customer_id,
      p_terms_accepted_at,
      btrim(p_terms_acceptance_channel),
      btrim(p_terms_acceptance_method),
      coalesce(p_terms_recorded_by, p_actor_id),
      v_terms.content_hash,
      v_terms.version_label
    );
  end if;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_created',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := p_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_appointment.id,
    p_before_state := null,
    p_after_state := to_jsonb(v_appointment),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment.id,
    'status', v_appointment.status,
    'starts_at', v_appointment.starts_at,
    'ends_at', v_appointment.ends_at,
    'occupied_from', v_appointment.occupied_from,
    'occupied_until', v_appointment.occupied_until
  );

  if v_idempotency_enabled then
    perform public.complete_business_idempotency_key_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_result_snapshot := v_result
    );
  end if;

  return v_result;
exception
  when others then
    if v_idempotency_enabled then
      begin
        perform public.fail_business_idempotency_key_for_appointment(
          p_id := p_idempotency_key_id,
          p_claim_token := p_idempotency_claim_token,
          p_error_summary := left(coalesce(sqlstate, '00000') || ':' || coalesce(sqlerrm, 'unknown'), 600),
          p_retryable := (sqlstate not in ('23514', '42501', 'P0002'))
        );
      exception
        when others then
          null;
      end;
    end if;
    raise;
end;
$$;

create or replace function public.reschedule_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_new_resource_ids uuid[] default null,
  p_reason text default null,
  p_new_location_id uuid default null,
  p_new_service_id uuid default null,
  p_new_employee_id uuid default null,
  p_new_expires_at timestamptz default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before public.salon_appointments%rowtype;
  v_after public.salon_appointments%rowtype;
  v_timing record;
  v_target_location_id uuid;
  v_target_service_id uuid;
  v_target_employee_id uuid;
  v_employee_name text;
  v_new_ends_at timestamptz;
  v_new_occupied_from timestamptz;
  v_new_occupied_until timestamptz;
  v_new_expires_at timestamptz;
  v_reason text;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
begin
  v_idempotency_enabled := p_idempotency_key_id is not null or p_idempotency_claim_token is not null;
  if v_idempotency_enabled then
    if p_idempotency_key_id is null or p_idempotency_claim_token is null then
      raise exception 'both idempotency_key_id and claim_token are required together' using errcode = '23514';
    end if;
    perform public.assert_business_idempotency_claim_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_studio_id := p_studio_id,
      p_operation_scope := 'salon_appointment:reschedule'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  if p_new_starts_at is null then
    raise exception 'new starts_at is required' using errcode = '23514';
  end if;

  select * into v_before
  from public.salon_appointments
  where id = p_appointment_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if p_actor_role = 'customer' then
    perform public.assert_salon_customer_actor(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_salon_customer_id := v_before.salon_customer_id
    );
  end if;

  if v_before.status not in ('pending', 'confirmed') then
    raise exception 'only pending/confirmed appointment can be rescheduled, current=%', v_before.status using errcode = '23514';
  end if;

  v_target_location_id := coalesce(p_new_location_id, v_before.location_id);
  v_target_service_id := coalesce(p_new_service_id, v_before.service_id);
  v_target_employee_id := coalesce(p_new_employee_id, v_before.employee_id);

  select * into v_timing
  from public.get_effective_service_timing_for_appointment(p_studio_id, v_target_service_id, v_target_location_id);

  v_new_ends_at := p_new_starts_at + make_interval(mins => v_timing.duration_minutes);
  v_new_occupied_from := p_new_starts_at - make_interval(mins => v_timing.prep_minutes);
  v_new_occupied_until := v_new_ends_at + make_interval(mins => v_timing.buffer_minutes);
  v_new_expires_at := case
    when v_before.status = 'pending' then coalesce(p_new_expires_at, v_before.expires_at, now() + interval '15 minutes')
    else null
  end;
  v_reason := coalesce(nullif(btrim(p_reason), ''), 'rescheduled');

  perform public.assert_employee_available_for_appointment(
    p_studio_id,
    v_target_location_id,
    v_target_service_id,
    v_target_employee_id,
    v_new_occupied_from,
    v_new_occupied_until
  );

  perform * from public.assert_resources_valid_for_appointment(
    p_studio_id,
    v_target_location_id,
    v_target_service_id,
    p_new_resource_ids
  );

  select display_name into v_employee_name
  from public.employees
  where id = v_target_employee_id and studio_id = p_studio_id
  for update;

  if v_employee_name is null then
    raise exception 'employee % not found in studio %', v_target_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  update public.salon_appointments
  set
    location_id = v_target_location_id,
    service_id = v_target_service_id,
    employee_id = v_target_employee_id,
    starts_at = p_new_starts_at,
    ends_at = v_new_ends_at,
    occupied_from = v_new_occupied_from,
    occupied_until = v_new_occupied_until,
    expires_at = v_new_expires_at,
    service_title_snapshot = v_timing.service_title,
    service_price_snapshot = v_timing.service_price,
    service_currency_snapshot = v_timing.service_currency,
    service_duration_snapshot_minutes = v_timing.duration_minutes,
    prep_snapshot_minutes = v_timing.prep_minutes,
    buffer_snapshot_minutes = v_timing.buffer_minutes,
    employee_name_snapshot = v_employee_name,
    location_name_snapshot = v_timing.location_name,
    updated_by = p_actor_id
  where id = v_before.id
  returning * into v_after;

  update public.salon_appointment_resources
  set is_active = false,
      released_at = now()
  where appointment_id = v_before.id
    and is_active;

  insert into public.salon_appointment_resources (
    appointment_id,
    resource_id,
    studio_id,
    location_id,
    occupied_from,
    occupied_until,
    is_active,
    released_at
  )
  select
    v_before.id,
    rv.resource_id,
    p_studio_id,
    v_target_location_id,
    v_new_occupied_from,
    v_new_occupied_until,
    true,
    null
  from public.assert_resources_valid_for_appointment(p_studio_id, v_target_location_id, v_target_service_id, p_new_resource_ids) rv;

  insert into public.salon_appointment_status_history (
    appointment_id,
    studio_id,
    from_status,
    to_status,
    actor,
    actor_id,
    actor_role,
    reason
  )
  values (
    v_before.id,
    p_studio_id,
    v_before.status,
    v_after.status,
    'user',
    p_actor_id,
    p_actor_role,
    v_reason
  );

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_rescheduled',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_target_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_before.id,
    p_before_state := to_jsonb(v_before),
    p_after_state := jsonb_build_object(
      'appointment', to_jsonb(v_after),
      'reschedule_reason', v_reason,
      'previous_starts_at', v_before.starts_at,
      'new_starts_at', v_after.starts_at
    ),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_after.id,
    'status', v_after.status,
    'starts_at', v_after.starts_at,
    'ends_at', v_after.ends_at,
    'occupied_from', v_after.occupied_from,
    'occupied_until', v_after.occupied_until,
    'reason', v_reason
  );

  if v_idempotency_enabled then
    perform public.complete_business_idempotency_key_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_result_snapshot := v_result
    );
  end if;

  return v_result;
exception
  when others then
    if v_idempotency_enabled then
      begin
        perform public.fail_business_idempotency_key_for_appointment(
          p_id := p_idempotency_key_id,
          p_claim_token := p_idempotency_claim_token,
          p_error_summary := left(coalesce(sqlstate, '00000') || ':' || coalesce(sqlerrm, 'unknown'), 600),
          p_retryable := (sqlstate not in ('23514', '42501', 'P0002'))
        );
      exception
        when others then
          null;
      end;
    end if;
    raise;
end;
$$;

create or replace function public.cancel_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_reason text,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before public.salon_appointments%rowtype;
  v_after public.salon_appointments%rowtype;
  v_reason text;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
begin
  v_idempotency_enabled := p_idempotency_key_id is not null or p_idempotency_claim_token is not null;
  if v_idempotency_enabled then
    if p_idempotency_key_id is null or p_idempotency_claim_token is null then
      raise exception 'both idempotency_key_id and claim_token are required together' using errcode = '23514';
    end if;
    perform public.assert_business_idempotency_claim_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_studio_id := p_studio_id,
      p_operation_scope := 'salon_appointment:cancel'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'cancellation reason is required' using errcode = '23514';
  end if;

  select * into v_before
  from public.salon_appointments
  where id = p_appointment_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if p_actor_role = 'customer' then
    perform public.assert_salon_customer_actor(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_salon_customer_id := v_before.salon_customer_id
    );
  end if;

  if v_before.status = 'cancelled' then
    v_result := jsonb_build_object(
      'ok', true,
      'appointment_id', v_before.id,
      'already_cancelled', true,
      'status', v_before.status
    );

    if v_idempotency_enabled then
      perform public.complete_business_idempotency_key_for_appointment(
        p_id := p_idempotency_key_id,
        p_claim_token := p_idempotency_claim_token,
        p_result_snapshot := v_result
      );
    end if;

    return v_result;
  end if;

  if v_before.status in ('completed', 'no_show') then
    raise exception 'appointment status % cannot be cancelled', v_before.status using errcode = '23514';
  end if;

  update public.salon_appointments
  set status = 'cancelled',
      cancellation_reason = v_reason,
      cancellation_actor_id = p_actor_id,
      cancellation_actor_role = p_actor_role,
      cancelled_at = now(),
      expires_at = null,
      updated_by = p_actor_id
  where id = v_before.id
  returning * into v_after;

  insert into public.salon_appointment_status_history (
    appointment_id,
    studio_id,
    from_status,
    to_status,
    actor,
    actor_id,
    actor_role,
    reason
  )
  values (
    v_before.id,
    p_studio_id,
    v_before.status,
    'cancelled',
    'user',
    p_actor_id,
    p_actor_role,
    v_reason
  );

  update public.salon_appointment_resources
  set is_active = false,
      released_at = now()
  where appointment_id = v_before.id
    and is_active;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_cancelled',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_before.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_before.id,
    p_before_state := to_jsonb(v_before),
    p_after_state := to_jsonb(v_after),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_after.id,
    'status', v_after.status,
    'already_cancelled', false,
    'cancelled_at', v_after.cancelled_at
  );

  if v_idempotency_enabled then
    perform public.complete_business_idempotency_key_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_result_snapshot := v_result
    );
  end if;

  return v_result;
exception
  when others then
    if v_idempotency_enabled then
      begin
        perform public.fail_business_idempotency_key_for_appointment(
          p_id := p_idempotency_key_id,
          p_claim_token := p_idempotency_claim_token,
          p_error_summary := left(coalesce(sqlstate, '00000') || ':' || coalesce(sqlerrm, 'unknown'), 600),
          p_retryable := (sqlstate not in ('23514', '42501', 'P0002'))
        );
      exception
        when others then
          null;
      end;
    end if;
    raise;
end;
$$;

revoke all on function public.assert_salon_customer_actor(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assert_salon_customer_actor(uuid, uuid, uuid)
  to service_role;
