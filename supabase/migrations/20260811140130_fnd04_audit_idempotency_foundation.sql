-- FND-04: Strong audit and idempotency foundation.
-- Adds three reusable primitives for later critical-write modules
-- (Appointment, Package, POS, Provider Webhooks, Commission, Payroll):
--   1. strong_audit_logs      - append-only audit for critical mutations
--   2. business_idempotency_keys - Studio-scoped Claim/Complete/Fail store
--   3. provider_events        - Provider/Event-ID replay dedup
-- Does not touch employees/employee_locations (124_employee_foundation.sql),
-- salon_customers (salon_customer_foundation), service_locations
-- (fnd03_service_location_publish), or the existing best-effort
-- operation_audits table / writeOperationAudit() path — all of those are
-- preserved exactly as-is. No Appointment/POS/Package/Commission/Payroll
-- business logic is implemented here.
--
-- Legacy operation_audits decision: target_type on that table spans dozens
-- of unrelated entity kinds with no uniform join path to a studio, so no
-- schema change or backfill is attempted there (would require guessing).
-- New critical-path audits should use strong_audit_logs, which has a
-- mandatory studio_id, instead.
--
-- Grant posture (stricter than FND-01/02/03's "grant all to service_role"):
-- all three tables below grant service_role SELECT only. Every insert and
-- status transition goes through a SECURITY DEFINER RPC (which executes as
-- the table owner and so is unaffected by the table grants). This makes the
-- Claim/Complete/Fail atomicity and the audit table's append-only guarantee
-- real database properties, not just an application convention.


-- ── strong_audit_logs ───────────────────────────────────────────────────
create table if not exists public.strong_audit_logs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  actor_type text not null check (actor_type = any (array['user'::text, 'system'::text, 'service'::text])),
  -- Keep the immutable actor identifier even if the auth account is later
  -- removed; an FK with ON DELETE SET NULL would require mutating this row.
  actor_id uuid,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  correlation_id text,
  idempotency_key_id uuid,
  provider_event_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_strong_audit_logs_studio_created
  on public.strong_audit_logs (studio_id, created_at desc);

create index if not exists idx_strong_audit_logs_target
  on public.strong_audit_logs (target_type, target_id);

create index if not exists idx_strong_audit_logs_location
  on public.strong_audit_logs (location_id) where location_id is not null;

create index if not exists idx_strong_audit_logs_idempotency_key
  on public.strong_audit_logs (idempotency_key_id) where idempotency_key_id is not null;

create index if not exists idx_strong_audit_logs_provider_event
  on public.strong_audit_logs (provider_event_id) where provider_event_id is not null;

create index if not exists idx_strong_audit_logs_action
  on public.strong_audit_logs (action);

create index if not exists idx_strong_audit_logs_correlation
  on public.strong_audit_logs (correlation_id) where correlation_id is not null;

-- Validates location_id (when present) belongs to studio_id, mirroring
-- service_locations_validate_studio (fnd03_service_location_publish.sql).
create or replace function public.validate_strong_audit_studio_location()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_reference_studio uuid;
begin
  if new.location_id is not null then
    select studio_id into v_location_studio from public.locations where id = new.location_id;
    if v_location_studio is null then
      raise exception 'strong_audit_logs references a missing location' using errcode = '23503';
    end if;
    if v_location_studio <> new.studio_id then
      raise exception 'strong_audit_logs.location_id must belong to strong_audit_logs.studio_id'
        using errcode = '23514';
    end if;
  end if;

  if new.idempotency_key_id is not null then
    select studio_id into v_reference_studio
    from public.business_idempotency_keys
    where id = new.idempotency_key_id;
    if v_reference_studio is null then
      raise exception 'strong_audit_logs references a missing idempotency key' using errcode = '23503';
    end if;
    if v_reference_studio <> new.studio_id then
      raise exception 'strong_audit_logs.idempotency_key_id must belong to strong_audit_logs.studio_id'
        using errcode = '23514';
    end if;
  end if;

  if new.provider_event_id is not null then
    select studio_id into v_reference_studio
    from public.provider_events
    where id = new.provider_event_id;
    if not found then
      raise exception 'strong_audit_logs references a missing provider event' using errcode = '23503';
    end if;
    if v_reference_studio is null then
      raise exception 'strong_audit_logs.provider_event_id must reference a studio-scoped provider event'
        using errcode = '23514';
    end if;
    if v_reference_studio <> new.studio_id then
      raise exception 'strong_audit_logs.provider_event_id must belong to strong_audit_logs.studio_id'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists strong_audit_logs_validate_studio_location_trg on public.strong_audit_logs;
create trigger strong_audit_logs_validate_studio_location_trg
  before insert on public.strong_audit_logs
  for each row execute function public.validate_strong_audit_studio_location();

-- Append-only enforcement: blocks UPDATE/DELETE even for the table owner's
-- own future code, independent of (and in addition to) the missing grants
-- below. Normal application paths must never modify or remove a strong
-- audit record.
create or replace function public.prevent_strong_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  raise exception 'strong_audit_logs is append-only: % is not permitted', tg_op
    using errcode = '9A001';
end;
$$;

drop trigger if exists strong_audit_logs_prevent_mutation_trg on public.strong_audit_logs;
create trigger strong_audit_logs_prevent_mutation_trg
  before update or delete on public.strong_audit_logs
  for each row execute function public.prevent_strong_audit_mutation();

alter table public.strong_audit_logs enable row level security;

revoke all on table public.strong_audit_logs from public;
revoke all on table public.strong_audit_logs from anon;
revoke all on table public.strong_audit_logs from authenticated;
grant select on table public.strong_audit_logs to service_role;

-- Reusable strong-audit primitive. Future business RPCs call this with
-- `perform public.record_strong_audit(...)` from inside their own
-- SECURITY DEFINER function so the audit write commits/rolls back in the
-- same database transaction as the business mutation it documents. The
-- src/lib/strong-audit.ts writeStrongAudit() wrapper calls this RPC
-- standalone for system/webhook contexts where no larger transaction exists.
create or replace function public.record_strong_audit(
  p_studio_id uuid,
  p_action text,
  p_target_type text,
  p_actor_type text default 'system',
  p_location_id uuid default null,
  p_actor_id uuid default null,
  p_actor_role text default null,
  p_target_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_correlation_id text default null,
  p_idempotency_key_id uuid default null,
  p_provider_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  insert into public.strong_audit_logs (
    studio_id, location_id, actor_type, actor_id, actor_role, action, target_type, target_id,
    before_state, after_state, correlation_id, idempotency_key_id, provider_event_id
  ) values (
    p_studio_id, p_location_id, p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id,
    p_before_state, p_after_state, p_correlation_id, p_idempotency_key_id, p_provider_event_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_strong_audit(uuid, text, text, text, uuid, uuid, text, uuid, jsonb, jsonb, text, uuid, uuid) from public;
revoke all on function public.record_strong_audit(uuid, text, text, text, uuid, uuid, text, uuid, jsonb, jsonb, text, uuid, uuid) from anon;
revoke all on function public.record_strong_audit(uuid, text, text, text, uuid, uuid, text, uuid, jsonb, jsonb, text, uuid, uuid) from authenticated;
grant execute on function public.record_strong_audit(uuid, text, text, text, uuid, uuid, text, uuid, jsonb, jsonb, text, uuid, uuid) to service_role;


-- ── business_idempotency_keys ───────────────────────────────────────────
create table if not exists public.business_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  operation_scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  claim_token uuid not null default gen_random_uuid(),
  status text not null default 'processing' check (status = any (array['processing'::text, 'completed'::text, 'failed'::text])),
  retryable boolean not null default true,
  attempt_count integer not null default 1 check (attempt_count > 0),
  result_snapshot jsonb,
  error_summary text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keeps a locally re-run, earlier draft of this migration upgradeable.
alter table public.business_idempotency_keys
  add column if not exists claim_token uuid default gen_random_uuid();
update public.business_idempotency_keys set claim_token = gen_random_uuid() where claim_token is null;
alter table public.business_idempotency_keys alter column claim_token set not null;

create unique index if not exists business_idempotency_keys_studio_scope_key_unique
  on public.business_idempotency_keys (studio_id, operation_scope, idempotency_key);

create index if not exists idx_business_idempotency_keys_status
  on public.business_idempotency_keys (status);

create index if not exists idx_business_idempotency_keys_processing_claimed
  on public.business_idempotency_keys (claimed_at) where status = 'processing';

-- public.set_updated_at_timestamp() already exists (124_employee_foundation.sql).
drop trigger if exists set_business_idempotency_keys_updated_at on public.business_idempotency_keys;
create trigger set_business_idempotency_keys_updated_at
  before update on public.business_idempotency_keys
  for each row execute function public.set_updated_at_timestamp();

alter table public.business_idempotency_keys enable row level security;

revoke all on table public.business_idempotency_keys from public;
revoke all on table public.business_idempotency_keys from anon;
revoke all on table public.business_idempotency_keys from authenticated;
grant select on table public.business_idempotency_keys to service_role;

-- Atomic Claim. The `select ... for update` row lock is what makes
-- concurrent claims safe: a second concurrent caller blocks on that lock
-- until the first transaction commits, then re-reads the now-updated row
-- and correctly sees 'in_progress' / 'already_completed' instead of also
-- claiming. Same key + same request_hash always returns the existing
-- state/result; same key + a different request_hash is rejected
-- (hash_conflict) and never overwrites the original claim.
create or replace function public.claim_business_idempotency_key(
  p_studio_id uuid,
  p_operation_scope text,
  p_idempotency_key text,
  p_request_hash text,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_row public.business_idempotency_keys%rowtype;
begin
  if p_stale_after_seconds <= 0 then
    raise exception 'p_stale_after_seconds must be greater than zero' using errcode = '22023';
  end if;

  insert into public.business_idempotency_keys (studio_id, operation_scope, idempotency_key, request_hash, status, attempt_count, claimed_at)
  values (p_studio_id, p_operation_scope, p_idempotency_key, p_request_hash, 'processing', 1, now())
  on conflict (studio_id, operation_scope, idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    select * into v_row from public.business_idempotency_keys where id = v_id;
    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_id,
      'claimToken', v_row.claim_token, 'attemptCount', 1
    );
  end if;

  select * into v_row from public.business_idempotency_keys
    where studio_id = p_studio_id and operation_scope = p_operation_scope and idempotency_key = p_idempotency_key
    for update;

  if v_row.request_hash <> p_request_hash then
    return jsonb_build_object('ok', false, 'outcome', 'hash_conflict', 'id', v_row.id);
  end if;

  if v_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'outcome', 'already_completed', 'id', v_row.id, 'result', v_row.result_snapshot);
  end if;

  if v_row.status = 'failed' then
    if not v_row.retryable then
      return jsonb_build_object('ok', false, 'outcome', 'permanently_failed', 'id', v_row.id, 'errorSummary', v_row.error_summary);
    end if;

    update public.business_idempotency_keys
    set status = 'processing', attempt_count = attempt_count + 1, claim_token = gen_random_uuid(),
        claimed_at = now(), failed_at = null, error_summary = null
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_row.id,
      'claimToken', v_row.claim_token, 'attemptCount', v_row.attempt_count
    );
  end if;

  -- status = 'processing'
  if v_row.claimed_at < now() - make_interval(secs => p_stale_after_seconds) then
    update public.business_idempotency_keys
    set attempt_count = attempt_count + 1, claim_token = gen_random_uuid(), claimed_at = now()
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_row.id,
      'claimToken', v_row.claim_token, 'attemptCount', v_row.attempt_count
    );
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'in_progress', 'id', v_row.id);
end;
$$;

revoke all on function public.claim_business_idempotency_key(uuid, text, text, text, integer) from public;
revoke all on function public.claim_business_idempotency_key(uuid, text, text, text, integer) from anon;
revoke all on function public.claim_business_idempotency_key(uuid, text, text, text, integer) from authenticated;
grant execute on function public.claim_business_idempotency_key(uuid, text, text, text, integer) to service_role;

-- Remove the unfenced draft signature when this migration is re-run in a
-- local database that previously applied it directly.
drop function if exists public.complete_business_idempotency_key(uuid, jsonb);

create or replace function public.complete_business_idempotency_key(
  p_id uuid,
  p_claim_token uuid,
  p_result_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.business_idempotency_keys%rowtype;
begin
  update public.business_idempotency_keys
  set status = 'completed', result_snapshot = p_result_snapshot, completed_at = now()
  where id = p_id and status = 'processing' and claim_token = p_claim_token
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

revoke all on function public.complete_business_idempotency_key(uuid, uuid, jsonb) from public;
revoke all on function public.complete_business_idempotency_key(uuid, uuid, jsonb) from anon;
revoke all on function public.complete_business_idempotency_key(uuid, uuid, jsonb) from authenticated;
grant execute on function public.complete_business_idempotency_key(uuid, uuid, jsonb) to service_role;

drop function if exists public.fail_business_idempotency_key(uuid, text, boolean);

create or replace function public.fail_business_idempotency_key(
  p_id uuid,
  p_claim_token uuid,
  p_error_summary text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.business_idempotency_keys%rowtype;
begin
  update public.business_idempotency_keys
  set status = 'failed', error_summary = p_error_summary, retryable = p_retryable, failed_at = now()
  where id = p_id and status = 'processing' and claim_token = p_claim_token
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

revoke all on function public.fail_business_idempotency_key(uuid, uuid, text, boolean) from public;
revoke all on function public.fail_business_idempotency_key(uuid, uuid, text, boolean) from anon;
revoke all on function public.fail_business_idempotency_key(uuid, uuid, text, boolean) from authenticated;
grant execute on function public.fail_business_idempotency_key(uuid, uuid, text, boolean) to service_role;


-- ── provider_events ─────────────────────────────────────────────────────
-- studio_id/location_id are nullable: a webhook often arrives before the
-- handler has resolved which studio it belongs to (studio is typically
-- derived by looking up a payment/campaign referenced inside the payload),
-- but Provider/Event-ID dedup must work at that point. Consistency between
-- studio_id and location_id is validated only when both are present.
create table if not exists public.provider_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  provider text not null,
  provider_event_id text not null,
  event_type text,
  payload_hash text not null,
  claim_token uuid not null default gen_random_uuid(),
  safe_payload jsonb,
  status text not null default 'processing' check (status = any (array['processing'::text, 'processed'::text, 'failed'::text])),
  retryable boolean not null default true,
  attempt_count integer not null default 1 check (attempt_count > 0),
  error_summary text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_events
  add column if not exists claim_token uuid default gen_random_uuid();
update public.provider_events set claim_token = gen_random_uuid() where claim_token is null;
alter table public.provider_events alter column claim_token set not null;

create unique index if not exists provider_events_provider_event_id_unique
  on public.provider_events (provider, provider_event_id);

create index if not exists idx_provider_events_status
  on public.provider_events (status);

create index if not exists idx_provider_events_studio
  on public.provider_events (studio_id) where studio_id is not null;

create index if not exists idx_provider_events_location
  on public.provider_events (location_id) where location_id is not null;

create index if not exists idx_provider_events_processing_received
  on public.provider_events (received_at) where status = 'processing';

create or replace function public.validate_provider_event_studio_location()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
begin
  if new.location_id is not null and new.studio_id is null then
    raise exception 'provider_events.location_id requires provider_events.studio_id'
      using errcode = '23514';
  end if;

  if new.studio_id is not null and new.location_id is not null then
    select studio_id into v_location_studio from public.locations where id = new.location_id;
    if v_location_studio is null then
      raise exception 'provider_events references a missing location' using errcode = '23503';
    end if;
    if v_location_studio <> new.studio_id then
      raise exception 'provider_events.location_id must belong to provider_events.studio_id'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists provider_events_validate_studio_location_trg on public.provider_events;
create trigger provider_events_validate_studio_location_trg
  before insert or update of studio_id, location_id on public.provider_events
  for each row execute function public.validate_provider_event_studio_location();

drop trigger if exists set_provider_events_updated_at on public.provider_events;
create trigger set_provider_events_updated_at
  before update on public.provider_events
  for each row execute function public.set_updated_at_timestamp();

alter table public.provider_events enable row level security;

revoke all on table public.provider_events from public;
revoke all on table public.provider_events from anon;
revoke all on table public.provider_events from authenticated;
grant select on table public.provider_events to service_role;

-- Same Claim shape as claim_business_idempotency_key. A replayed event
-- (same provider_event_id + same payload_hash, already 'processed') returns
-- already_processed so the caller skips the business action; a different
-- payload_hash under the same provider_event_id is a payload_conflict and
-- never overwrites the original event.
create or replace function public.claim_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_payload_hash text,
  p_event_type text default null,
  p_studio_id uuid default null,
  p_location_id uuid default null,
  p_safe_payload jsonb default null,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_row public.provider_events%rowtype;
begin
  if p_stale_after_seconds <= 0 then
    raise exception 'p_stale_after_seconds must be greater than zero' using errcode = '22023';
  end if;

  insert into public.provider_events (studio_id, location_id, provider, provider_event_id, event_type, payload_hash, safe_payload, status, attempt_count, received_at)
  values (p_studio_id, p_location_id, p_provider, p_provider_event_id, p_event_type, p_payload_hash, p_safe_payload, 'processing', 1, now())
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  if v_id is not null then
    select * into v_row from public.provider_events where id = v_id;
    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_id,
      'claimToken', v_row.claim_token, 'attemptCount', 1
    );
  end if;

  select * into v_row from public.provider_events
    where provider = p_provider and provider_event_id = p_provider_event_id
    for update;

  if v_row.payload_hash <> p_payload_hash then
    return jsonb_build_object('ok', false, 'outcome', 'payload_conflict', 'id', v_row.id);
  end if;

  if (p_studio_id is not null and v_row.studio_id is not null and p_studio_id <> v_row.studio_id)
     or (p_location_id is not null and v_row.location_id is not null and p_location_id <> v_row.location_id) then
    return jsonb_build_object('ok', false, 'outcome', 'scope_conflict', 'id', v_row.id);
  end if;

  -- A webhook can be claimed before its tenant is resolved. A replay with
  -- the same verified payload may fill missing scope/diagnostic metadata,
  -- but can never overwrite an existing scope.
  if (v_row.studio_id is null and p_studio_id is not null)
     or (v_row.location_id is null and p_location_id is not null)
     or (v_row.event_type is null and p_event_type is not null)
     or (v_row.safe_payload is null and p_safe_payload is not null) then
    update public.provider_events
    set studio_id = coalesce(studio_id, p_studio_id),
        location_id = coalesce(location_id, p_location_id),
        event_type = coalesce(event_type, p_event_type),
        safe_payload = coalesce(safe_payload, p_safe_payload)
    where id = v_row.id
    returning * into v_row;
  end if;

  if v_row.status = 'processed' then
    return jsonb_build_object('ok', true, 'outcome', 'already_processed', 'id', v_row.id, 'duplicate', true);
  end if;

  if v_row.status = 'failed' then
    if not v_row.retryable then
      return jsonb_build_object('ok', false, 'outcome', 'permanently_failed', 'id', v_row.id, 'errorSummary', v_row.error_summary);
    end if;

    update public.provider_events
    set status = 'processing', attempt_count = attempt_count + 1, claim_token = gen_random_uuid(),
        received_at = now(), failed_at = null, error_summary = null
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_row.id,
      'claimToken', v_row.claim_token, 'attemptCount', v_row.attempt_count
    );
  end if;

  -- status = 'processing'
  if v_row.received_at < now() - make_interval(secs => p_stale_after_seconds) then
    update public.provider_events
    set attempt_count = attempt_count + 1, claim_token = gen_random_uuid(), received_at = now()
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true, 'outcome', 'claimed', 'id', v_row.id,
      'claimToken', v_row.claim_token, 'attemptCount', v_row.attempt_count
    );
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'in_progress', 'id', v_row.id, 'duplicate', true);
end;
$$;

revoke all on function public.claim_provider_event(text, text, text, text, uuid, uuid, jsonb, integer) from public;
revoke all on function public.claim_provider_event(text, text, text, text, uuid, uuid, jsonb, integer) from anon;
revoke all on function public.claim_provider_event(text, text, text, text, uuid, uuid, jsonb, integer) from authenticated;
grant execute on function public.claim_provider_event(text, text, text, text, uuid, uuid, jsonb, integer) to service_role;

drop function if exists public.complete_provider_event(uuid);
drop function if exists public.complete_provider_event(uuid, uuid);

create or replace function public.complete_provider_event(
  p_id uuid,
  p_claim_token uuid,
  p_studio_id uuid default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.provider_events%rowtype;
begin
  select * into v_row
  from public.provider_events
  where id = p_id and status = 'processing' and claim_token = p_claim_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  if (p_studio_id is not null and v_row.studio_id is not null and p_studio_id <> v_row.studio_id)
     or (p_location_id is not null and v_row.location_id is not null and p_location_id <> v_row.location_id) then
    return jsonb_build_object('ok', false, 'reason', 'scope_conflict');
  end if;

  if coalesce(v_row.location_id, p_location_id) is not null
     and coalesce(v_row.studio_id, p_studio_id) is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_scope');
  end if;

  update public.provider_events
  set studio_id = coalesce(studio_id, p_studio_id),
      location_id = coalesce(location_id, p_location_id),
      status = 'processed',
      processed_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

revoke all on function public.complete_provider_event(uuid, uuid, uuid, uuid) from public;
revoke all on function public.complete_provider_event(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.complete_provider_event(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.complete_provider_event(uuid, uuid, uuid, uuid) to service_role;

drop function if exists public.fail_provider_event(uuid, text, boolean);
drop function if exists public.fail_provider_event(uuid, uuid, text, boolean);

create or replace function public.fail_provider_event(
  p_id uuid,
  p_claim_token uuid,
  p_error_summary text,
  p_retryable boolean default true,
  p_studio_id uuid default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.provider_events%rowtype;
begin
  select * into v_row
  from public.provider_events
  where id = p_id and status = 'processing' and claim_token = p_claim_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  if (p_studio_id is not null and v_row.studio_id is not null and p_studio_id <> v_row.studio_id)
     or (p_location_id is not null and v_row.location_id is not null and p_location_id <> v_row.location_id) then
    return jsonb_build_object('ok', false, 'reason', 'scope_conflict');
  end if;

  if coalesce(v_row.location_id, p_location_id) is not null
     and coalesce(v_row.studio_id, p_studio_id) is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_scope');
  end if;

  update public.provider_events
  set studio_id = coalesce(studio_id, p_studio_id),
      location_id = coalesce(location_id, p_location_id),
      status = 'failed',
      error_summary = p_error_summary,
      retryable = p_retryable,
      failed_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

revoke all on function public.fail_provider_event(uuid, uuid, text, boolean, uuid, uuid) from public;
revoke all on function public.fail_provider_event(uuid, uuid, text, boolean, uuid, uuid) from anon;
revoke all on function public.fail_provider_event(uuid, uuid, text, boolean, uuid, uuid) from authenticated;
grant execute on function public.fail_provider_event(uuid, uuid, text, boolean, uuid, uuid) to service_role;


-- ── strong_audit_logs immutable FKs ────────────────────────────────────
-- Recreate draft constraints so a local direct re-run also upgrades the
-- former CASCADE / SET NULL actions, which conflict with append-only rows.
alter table public.strong_audit_logs
  drop constraint if exists strong_audit_logs_actor_id_fkey,
  drop constraint if exists strong_audit_logs_studio_id_fkey,
  drop constraint if exists strong_audit_logs_location_id_fkey,
  drop constraint if exists strong_audit_logs_idempotency_key_id_fkey,
  drop constraint if exists strong_audit_logs_provider_event_id_fkey;

alter table public.strong_audit_logs
  add constraint strong_audit_logs_studio_id_fkey
    foreign key (studio_id) references public.studios(id) on delete restrict,
  add constraint strong_audit_logs_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete restrict,
  add constraint strong_audit_logs_idempotency_key_id_fkey
    foreign key (idempotency_key_id) references public.business_idempotency_keys(id) on delete restrict,
  add constraint strong_audit_logs_provider_event_id_fkey
    foreign key (provider_event_id) references public.provider_events(id) on delete restrict;
