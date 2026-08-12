-- APT-05 incremental: ops manual retry RPC for appointment email queue.

create or replace function public.retry_appointment_notification_email_job(
  p_job_id uuid,
  p_actor_id uuid default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.appointment_notification_queue%rowtype;
begin
  if p_job_id is null then
    raise exception 'p_job_id is required' using errcode = '22023';
  end if;

  select * into v_row
  from public.appointment_notification_queue
  where id = p_job_id
  for update;

  if not found then
    raise exception 'notification job % not found', p_job_id using errcode = 'P0002';
  end if;

  if v_row.status = 'sent' then
    return jsonb_build_object(
      'ok', true,
      'job_id', v_row.id,
      'already_final', true,
      'status', v_row.status
    );
  end if;

  if v_row.status = 'processing' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'in_progress',
      'job_id', v_row.id,
      'status', v_row.status
    );
  end if;

  if v_row.recipient_email is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'missing_recipient_email',
      'job_id', v_row.id,
      'status', v_row.status
    );
  end if;

  update public.appointment_notification_queue
  set status = 'pending',
      next_attempt_at = now(),
      claimed_at = null,
      processed_by = null,
      claim_token = gen_random_uuid(),
      last_error = null,
      last_error_at = null
  where id = v_row.id
  returning * into v_row;

  perform public.record_strong_audit(
    p_studio_id := v_row.studio_id,
    p_action := 'appointment_notification_retry_requested',
    p_target_type := 'salon_appointment',
    p_actor_type := case when p_actor_id is null then 'service' else 'user' end,
    p_location_id := v_row.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_row.appointment_id,
    p_before_state := null,
    p_after_state := jsonb_build_object(
      'job_id', v_row.id,
      'event_type', v_row.event_type,
      'status', v_row.status,
      'attempt_count', v_row.attempt_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'already_final', false,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'next_attempt_at', v_row.next_attempt_at
  );
end;
$$;

revoke all on function public.retry_appointment_notification_email_job(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.retry_appointment_notification_email_job(uuid, uuid, text)
  to service_role;
