-- APT-05: appointment email notifications queue.
-- Scope:
--   * queue table for appointment notification email jobs
--   * enqueue / claim / complete / fail / list RPCs
--   * stale reminder invalidation on reschedule/cancel events
--   * retry with exponential backoff and claim-token fencing

-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function public.assert_appointment_notification_event_type(p_event_type text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_event_type not in (
    'appointment_created',
    'appointment_confirmed',
    'appointment_rescheduled',
    'appointment_cancelled',
    'appointment_reminder_24h',
    'appointment_reminder_2h'
  ) then
    raise exception 'invalid appointment notification event type %', p_event_type using errcode = '22023';
  end if;
end;
$$;

create or replace function public.assert_appointment_notification_status(p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_status not in ('pending', 'processing', 'sent', 'failed', 'invalidated') then
    raise exception 'invalid appointment notification status %', p_status using errcode = '22023';
  end if;
end;
$$;

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.appointment_notification_queue (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  appointment_id uuid not null references public.salon_appointments(id) on delete cascade,
  event_type text not null,
  channel text not null default 'email' check (channel = 'email'),
  dedupe_key text not null,
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 6 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz,
  processed_by text,
  sent_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_notification_queue_dedupe_unique unique (dedupe_key),
  constraint appointment_notification_queue_send_or_invalidate check (
    not (sent_at is not null and invalidated_at is not null)
  )
);

create index if not exists idx_appointment_notification_queue_studio_created
  on public.appointment_notification_queue (studio_id, created_at desc);

create index if not exists idx_appointment_notification_queue_appointment
  on public.appointment_notification_queue (appointment_id, created_at desc);

create index if not exists idx_appointment_notification_queue_pending_pick
  on public.appointment_notification_queue (status, next_attempt_at, scheduled_for, id)
  where status = 'pending';

create index if not exists idx_appointment_notification_queue_processing_claimed
  on public.appointment_notification_queue (claimed_at)
  where status = 'processing';

create or replace function public.appointment_notification_queue_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appointment record;
  v_location_studio uuid;
begin
  perform public.assert_appointment_notification_event_type(new.event_type);
  perform public.assert_appointment_notification_status(new.status);

  select studio_id, location_id
  into v_appointment
  from public.salon_appointments
  where id = new.appointment_id;

  if v_appointment.studio_id is null then
    raise exception 'appointment % not found for notification queue', new.appointment_id using errcode = 'P0002';
  end if;

  if v_appointment.studio_id <> new.studio_id then
    raise exception 'notification queue studio mismatch for appointment %', new.appointment_id using errcode = '23514';
  end if;

  if v_appointment.location_id <> new.location_id then
    raise exception 'notification queue location mismatch for appointment %', new.appointment_id using errcode = '23514';
  end if;

  select studio_id into v_location_studio
  from public.locations
  where id = new.location_id;

  if v_location_studio is null or v_location_studio <> new.studio_id then
    raise exception 'notification queue location % does not belong to studio %', new.location_id, new.studio_id using errcode = '23514';
  end if;

  if new.status in ('pending', 'processing') and new.next_attempt_at < new.created_at - interval '2 minutes' then
    raise exception 'notification next_attempt_at is too early' using errcode = '23514';
  end if;

  if new.status = 'sent' and new.sent_at is null then
    raise exception 'sent notification requires sent_at timestamp' using errcode = '23514';
  end if;

  if new.status = 'invalidated' and new.invalidated_at is null then
    raise exception 'invalidated notification requires invalidated_at timestamp' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists appointment_notification_queue_validate_refs_trg on public.appointment_notification_queue;
create trigger appointment_notification_queue_validate_refs_trg
  before insert or update of studio_id, location_id, appointment_id, event_type, status, next_attempt_at, sent_at, invalidated_at
  on public.appointment_notification_queue
  for each row execute function public.appointment_notification_queue_validate_refs();

drop trigger if exists set_appointment_notification_queue_updated_at on public.appointment_notification_queue;
create trigger set_appointment_notification_queue_updated_at
  before update on public.appointment_notification_queue
  for each row execute function public.set_updated_at_timestamp();

alter table public.appointment_notification_queue enable row level security;

revoke all on table public.appointment_notification_queue from public;
revoke all on table public.appointment_notification_queue from anon;
revoke all on table public.appointment_notification_queue from authenticated;
grant all on table public.appointment_notification_queue to service_role;

-- ── RPC: enqueue ───────────────────────────────────────────────────────────
create or replace function public.enqueue_appointment_notification_email(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_scheduled_for timestamptz default null,
  p_payload jsonb default null,
  p_actor_id uuid default null,
  p_actor_role text default null,
  p_idempotency_key_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appointment record;
  v_recipient_email text;
  v_job_id uuid;
  v_existing_id uuid;
  v_status text;
  v_invalidated_count integer := 0;
  v_now timestamptz := now();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  perform public.assert_appointment_notification_event_type(p_event_type);

  if p_studio_id is null or p_appointment_id is null then
    raise exception 'enqueue_appointment_notification_email requires studio_id and appointment_id' using errcode = '22023';
  end if;

  if p_dedupe_key is null or length(trim(p_dedupe_key)) = 0 then
    raise exception 'enqueue_appointment_notification_email requires dedupe_key' using errcode = '22023';
  end if;

  select a.id, a.studio_id, a.location_id, a.salon_customer_id
  into v_appointment
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  select nullif(lower(trim(c.email)), '')
  into v_recipient_email
  from public.salon_customers c
  where c.id = v_appointment.salon_customer_id
    and c.studio_id = p_studio_id;

  if p_event_type in ('appointment_rescheduled', 'appointment_cancelled') then
    update public.appointment_notification_queue q
    set status = 'invalidated',
        invalidated_at = v_now,
        invalidation_reason = 'stale_after_reschedule_or_cancel',
        claimed_at = null,
        processed_by = null,
        claim_token = gen_random_uuid()
    where q.appointment_id = p_appointment_id
      and q.channel = 'email'
      and q.event_type in ('appointment_reminder_24h', 'appointment_reminder_2h')
      and q.status in ('pending', 'processing', 'failed');

    get diagnostics v_invalidated_count = row_count;
  end if;

  v_status := case when v_recipient_email is null then 'invalidated' else 'pending' end;

  insert into public.appointment_notification_queue (
    studio_id,
    location_id,
    appointment_id,
    event_type,
    channel,
    dedupe_key,
    recipient_email,
    payload,
    scheduled_for,
    status,
    next_attempt_at,
    invalidated_at,
    invalidation_reason
  )
  values (
    p_studio_id,
    v_appointment.location_id,
    p_appointment_id,
    p_event_type,
    'email',
    p_dedupe_key,
    v_recipient_email,
    v_payload,
    coalesce(p_scheduled_for, v_now),
    v_status,
    coalesce(p_scheduled_for, v_now),
    case when v_recipient_email is null then v_now else null end,
    case when v_recipient_email is null then 'missing_recipient_email' else null end
  )
  on conflict (dedupe_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select q.id into v_existing_id
    from public.appointment_notification_queue q
    where q.dedupe_key = p_dedupe_key;

    return jsonb_build_object(
      'ok', true,
      'deduped', true,
      'job_id', v_existing_id,
      'invalidated_reminder_count', v_invalidated_count
    );
  end if;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'appointment_notification_enqueued',
    p_target_type := 'salon_appointment',
    p_actor_type := case when p_actor_id is null then 'service' else 'user' end,
    p_location_id := v_appointment.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_appointment_id,
    p_before_state := null,
    p_after_state := jsonb_build_object(
      'job_id', v_job_id,
      'event_type', p_event_type,
      'recipient_email', v_recipient_email,
      'status', v_status,
      'scheduled_for', coalesce(p_scheduled_for, v_now),
      'invalidated_reminder_count', v_invalidated_count
    ),
    p_idempotency_key_id := p_idempotency_key_id
  );

  return jsonb_build_object(
    'ok', true,
    'deduped', false,
    'job_id', v_job_id,
    'status', v_status,
    'invalidated_reminder_count', v_invalidated_count
  );
end;
$$;

-- ── RPC: claim pending jobs (fencing) ──────────────────────────────────────
create or replace function public.claim_appointment_notification_email_jobs(
  p_batch_size integer default 30,
  p_worker_id text default null,
  p_stale_after_seconds integer default 300
)
returns setof public.appointment_notification_queue
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_batch_size is null or p_batch_size < 1 then
    raise exception 'p_batch_size must be >= 1' using errcode = '22023';
  end if;

  if p_stale_after_seconds is null or p_stale_after_seconds < 1 then
    raise exception 'p_stale_after_seconds must be >= 1' using errcode = '22023';
  end if;

  -- reclaim stale in-flight jobs first
  update public.appointment_notification_queue
  set status = 'pending',
      claimed_at = null,
      processed_by = null,
      claim_token = gen_random_uuid(),
      next_attempt_at = greatest(next_attempt_at, now())
  where status = 'processing'
    and claimed_at < now() - make_interval(secs => p_stale_after_seconds);

  return query
  with picked as (
    select q.id
    from public.appointment_notification_queue q
    where q.status = 'pending'
      and q.channel = 'email'
      and q.scheduled_for <= now()
      and q.next_attempt_at <= now()
    order by q.next_attempt_at asc, q.scheduled_for asc, q.created_at asc, q.id asc
    limit p_batch_size
    for update skip locked
  ), claimed as (
    update public.appointment_notification_queue q
    set status = 'processing',
        claimed_at = now(),
        processed_by = coalesce(nullif(trim(p_worker_id), ''), 'appointment-email-worker'),
        claim_token = gen_random_uuid()
    from picked
    where q.id = picked.id
    returning q.*
  )
  select * from claimed;
end;
$$;

-- ── RPC: mark sent ────────────────────────────────────────────────────────
create or replace function public.complete_appointment_notification_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_delivery_meta jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.appointment_notification_queue%rowtype;
begin
  update public.appointment_notification_queue
  set status = 'sent',
      sent_at = now(),
      last_error = null,
      last_error_at = null,
      processed_by = null,
      claimed_at = null,
      payload = coalesce(payload, '{}'::jsonb) || coalesce(p_delivery_meta, '{}'::jsonb)
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'job_id', v_row.id);
end;
$$;

-- ── RPC: mark failure and retry scheduling ────────────────────────────────
create or replace function public.fail_appointment_notification_email_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_summary text,
  p_retryable boolean default true,
  p_base_delay_seconds integer default 60,
  p_max_delay_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.appointment_notification_queue%rowtype;
  v_next_attempt integer;
  v_delay_seconds integer;
  v_retryable boolean := coalesce(p_retryable, true);
begin
  if p_base_delay_seconds is null or p_base_delay_seconds < 1 then
    raise exception 'p_base_delay_seconds must be >= 1' using errcode = '22023';
  end if;

  if p_max_delay_seconds is null or p_max_delay_seconds < p_base_delay_seconds then
    raise exception 'p_max_delay_seconds must be >= p_base_delay_seconds' using errcode = '22023';
  end if;

  select * into v_row
  from public.appointment_notification_queue
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  v_next_attempt := v_row.attempt_count + 1;

  if v_retryable and v_next_attempt < v_row.max_attempts then
    v_delay_seconds := least(
      p_max_delay_seconds,
      (p_base_delay_seconds * power(2::numeric, greatest(v_row.attempt_count, 0)::numeric))::integer
    );

    update public.appointment_notification_queue
    set status = 'pending',
        attempt_count = v_next_attempt,
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        last_error = left(coalesce(p_error_summary, 'unknown_error'), 1000),
        last_error_at = now(),
        processed_by = null,
        claimed_at = null,
        claim_token = gen_random_uuid()
    where id = p_job_id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true,
      'status', v_row.status,
      'job_id', v_row.id,
      'attempt_count', v_row.attempt_count,
      'next_attempt_at', v_row.next_attempt_at
    );
  end if;

  update public.appointment_notification_queue
  set status = 'failed',
      attempt_count = v_next_attempt,
      last_error = left(coalesce(p_error_summary, 'unknown_error'), 1000),
      last_error_at = now(),
      processed_by = null,
      claimed_at = null,
      claim_token = gen_random_uuid()
  where id = p_job_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'job_id', v_row.id,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

-- ── RPC: list logs (service-facing) ───────────────────────────────────────
create or replace function public.list_appointment_notification_email_jobs(
  p_studio_id uuid,
  p_location_id uuid default null,
  p_appointment_id uuid default null,
  p_statuses text[] default null,
  p_limit integer default 100
)
returns setof public.appointment_notification_queue
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if p_studio_id is null then
    raise exception 'p_studio_id is required' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500' using errcode = '22023';
  end if;

  if p_statuses is not null then
    foreach v_status in array p_statuses
    loop
      perform public.assert_appointment_notification_status(v_status);
    end loop;
  end if;

  return query
  select q.*
  from public.appointment_notification_queue q
  where q.studio_id = p_studio_id
    and (p_location_id is null or q.location_id = p_location_id)
    and (p_appointment_id is null or q.appointment_id = p_appointment_id)
    and (p_statuses is null or q.status = any(p_statuses))
  order by q.created_at desc, q.id desc
  limit p_limit;
end;
$$;

-- ── grants ────────────────────────────────────────────────────────────────
revoke all on function public.assert_appointment_notification_event_type(text)
  from public, anon, authenticated;
revoke all on function public.assert_appointment_notification_status(text)
  from public, anon, authenticated;
revoke all on function public.enqueue_appointment_notification_email(uuid, uuid, text, text, timestamptz, jsonb, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_appointment_notification_email_jobs(integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_appointment_notification_email_job(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_appointment_notification_email_job(uuid, uuid, text, boolean, integer, integer)
  from public, anon, authenticated;
revoke all on function public.list_appointment_notification_email_jobs(uuid, uuid, uuid, text[], integer)
  from public, anon, authenticated;

grant execute on function public.assert_appointment_notification_event_type(text)
  to service_role;
grant execute on function public.assert_appointment_notification_status(text)
  to service_role;
grant execute on function public.enqueue_appointment_notification_email(uuid, uuid, text, text, timestamptz, jsonb, uuid, text, uuid)
  to service_role;
grant execute on function public.claim_appointment_notification_email_jobs(integer, text, integer)
  to service_role;
grant execute on function public.complete_appointment_notification_email_job(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.fail_appointment_notification_email_job(uuid, uuid, text, boolean, integer, integer)
  to service_role;
grant execute on function public.list_appointment_notification_email_jobs(uuid, uuid, uuid, text[], integer)
  to service_role;
