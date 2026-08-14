-- PKG-02 mainline: Maker-Checker approval workflow foundation for manual package adjustments.
-- Scope:
--   * adjustment_requests / approval_logs tables
--   * strict state machine: draft -> submitted -> approved/rejected -> applied
--   * maker/checker segregation + no self-approval
--   * applied step writes append-only manual_adjustment ledger with strong audit + idempotency

create table if not exists public.pkg02_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  client_package_id uuid not null references public.client_packages(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  package_id uuid not null references public.packages(id) on delete restrict,
  requested_delta_credits integer not null check (requested_delta_credits <> 0),
  requested_value_delta_amount numeric(12,2),
  currency text not null default 'SGD' check (currency ~ '^[A-Z]{3}$'::text),
  reason text,
  status text not null default 'draft'
    check (status = any (array['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'applied'::text])),
  maker_user_id uuid not null references public.users(id) on delete restrict,
  maker_actor_role text not null
    check (maker_actor_role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text])),
  checker_user_id uuid references public.users(id) on delete restrict,
  checker_actor_role text
    check (checker_actor_role is null or checker_actor_role = any (array['owner'::text, 'manager'::text])),
  rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  applied_at timestamptz,
  applied_ledger_entry_id uuid references public.client_package_ledger_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pkg02_adjustment_requests_no_self_checker
    check (checker_user_id is null or checker_user_id <> maker_user_id),
  constraint pkg02_adjustment_requests_value_sign_check
    check (
      requested_value_delta_amount is null
      or (
        (requested_delta_credits > 0 and requested_value_delta_amount >= 0)
        or (requested_delta_credits < 0 and requested_value_delta_amount <= 0)
      )
    ),
  constraint pkg02_adjustment_requests_state_timestamps_check
    check (
      (status = 'draft' and submitted_at is null and approved_at is null and rejected_at is null and applied_at is null and checker_user_id is null and applied_ledger_entry_id is null)
      or (status = 'submitted' and submitted_at is not null and approved_at is null and rejected_at is null and applied_at is null and checker_user_id is null and applied_ledger_entry_id is null)
      or (status = 'approved' and submitted_at is not null and approved_at is not null and rejected_at is null and applied_at is null and checker_user_id is not null and applied_ledger_entry_id is null)
      or (status = 'rejected' and submitted_at is not null and approved_at is null and rejected_at is not null and applied_at is null and checker_user_id is not null and applied_ledger_entry_id is null)
      or (status = 'applied' and submitted_at is not null and approved_at is not null and rejected_at is null and applied_at is not null and checker_user_id is not null and applied_ledger_entry_id is not null)
    )
);

create index if not exists idx_pkg02_adjustment_requests_studio_status_created
  on public.pkg02_adjustment_requests (studio_id, status, created_at desc);

create index if not exists idx_pkg02_adjustment_requests_studio_package_created
  on public.pkg02_adjustment_requests (studio_id, client_package_id, created_at desc);

create unique index if not exists uq_pkg02_adjustment_requests_applied_ledger
  on public.pkg02_adjustment_requests (applied_ledger_entry_id)
  where applied_ledger_entry_id is not null;

alter table public.pkg02_adjustment_requests enable row level security;

revoke all on table public.pkg02_adjustment_requests from public;
revoke all on table public.pkg02_adjustment_requests from anon;
revoke all on table public.pkg02_adjustment_requests from authenticated;
grant all on table public.pkg02_adjustment_requests to service_role;

drop trigger if exists set_pkg02_adjustment_requests_updated_at on public.pkg02_adjustment_requests;
create trigger set_pkg02_adjustment_requests_updated_at
  before update on public.pkg02_adjustment_requests
  for each row execute function public.set_updated_at_timestamp();


create table if not exists public.pkg02_approval_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.pkg02_adjustment_requests(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  action text not null
    check (action = any (array[
      'draft_created'::text,
      'submitted'::text,
      'approved'::text,
      'rejected'::text,
      'applied'::text
    ])),
  approval_role text not null
    check (approval_role = any (array['maker'::text, 'checker'::text, 'system'::text])),
  actor_id uuid references public.users(id) on delete set null,
  actor_role text,
  from_status text
    check (from_status is null or from_status = any (array['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'applied'::text])),
  to_status text not null
    check (to_status = any (array['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'applied'::text])),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  audit_log_id uuid references public.strong_audit_logs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pkg02_approval_logs_request_created
  on public.pkg02_approval_logs (request_id, created_at asc);

create index if not exists idx_pkg02_approval_logs_studio_created
  on public.pkg02_approval_logs (studio_id, created_at desc);

alter table public.pkg02_approval_logs enable row level security;

revoke all on table public.pkg02_approval_logs from public;
revoke all on table public.pkg02_approval_logs from anon;
revoke all on table public.pkg02_approval_logs from authenticated;
grant all on table public.pkg02_approval_logs to service_role;

create or replace function public.pkg02_approval_logs_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'pkg02_approval_logs is append-only' using errcode = 'P0001';
end;
$$;

drop trigger if exists pkg02_approval_logs_no_update_trg on public.pkg02_approval_logs;
create trigger pkg02_approval_logs_no_update_trg
  before update on public.pkg02_approval_logs
  for each row execute function public.pkg02_approval_logs_append_only_guard();

drop trigger if exists pkg02_approval_logs_no_delete_trg on public.pkg02_approval_logs;
create trigger pkg02_approval_logs_no_delete_trg
  before delete on public.pkg02_approval_logs
  for each row execute function public.pkg02_approval_logs_append_only_guard();


create or replace function public.pkg02_assert_actor_scope(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_approval_role text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_owner boolean := false;
  v_has_membership boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if p_approval_role not in ('maker', 'checker') then
    raise exception 'invalid approval_role %', p_approval_role using errcode = '22023';
  end if;

  if p_actor_role not in ('owner', 'manager', 'frontdesk') then
    raise exception 'invalid actor role % for PKG-02 approval', p_actor_role using errcode = '42501';
  end if;

  if p_approval_role = 'checker' and p_actor_role not in ('owner', 'manager') then
    raise exception 'checker role must be owner or manager, got %', p_actor_role using errcode = '42501';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  if not exists (select 1 from public.studios s where s.id = p_studio_id) then
    raise exception 'studio % does not exist', p_studio_id using errcode = '23514';
  end if;

  if p_actor_role = 'owner' then
    select exists (
      select 1
      from public.studios s
      where s.id = p_studio_id
        and s.owner_id = p_actor_id
    ) into v_is_owner;

    if not v_is_owner then
      raise exception 'actor % is not owner for studio %', p_actor_id, p_studio_id using errcode = '42501';
    end if;

    return;
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.studio_id = p_studio_id
      and sm.user_id = p_actor_id
      and sm.role = p_actor_role
      and sm.is_active = true
  ) into v_has_membership;

  if not v_has_membership then
    raise exception 'actor % has no active % membership in studio %', p_actor_id, p_actor_role, p_studio_id
      using errcode = '42501';
  end if;
end;
$$;


create or replace function public.pkg02_create_adjustment_request(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_client_package_id uuid,
  p_requested_delta_credits integer,
  p_reason text default null,
  p_requested_value_delta_amount numeric default null,
  p_currency text default 'SGD',
  p_location_id uuid default null,
  p_salon_customer_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client_package public.client_packages;
  v_package public.packages;
  v_salon_customer public.salon_customers;
  v_request public.pkg02_adjustment_requests;
  v_audit_id uuid;
begin
  perform public.pkg02_assert_actor_scope(
    p_studio_id := p_studio_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_approval_role := 'maker'
  );

  if p_requested_delta_credits is null or p_requested_delta_credits = 0 then
    raise exception 'requested_delta_credits must be non-zero' using errcode = '22023';
  end if;

  if p_requested_value_delta_amount is not null then
    if (p_requested_delta_credits > 0 and p_requested_value_delta_amount < 0)
       or (p_requested_delta_credits < 0 and p_requested_value_delta_amount > 0) then
      raise exception 'requested_value_delta_amount must match requested_delta_credits sign' using errcode = '23514';
    end if;
  end if;

  if p_location_id is not null and not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.studio_id = p_studio_id
  ) then
    raise exception 'location % does not belong to studio %', p_location_id, p_studio_id using errcode = '23514';
  end if;

  select *
  into v_client_package
  from public.client_packages cp
  where cp.id = p_client_package_id;

  if not found then
    raise exception 'client package % not found', p_client_package_id using errcode = 'P0002';
  end if;

  select *
  into v_package
  from public.packages p
  where p.id = v_client_package.package_id
    and p.studio_id = p_studio_id;

  if not found then
    raise exception 'client package % is not in studio %', p_client_package_id, p_studio_id using errcode = '23514';
  end if;

  if p_salon_customer_id is null then
    select *
    into v_salon_customer
    from public.salon_customers sc
    where sc.studio_id = p_studio_id
      and sc.user_id = v_client_package.client_id
      and sc.merged_into_id is null
    order by sc.created_at asc
    limit 1;
  else
    select *
    into v_salon_customer
    from public.salon_customers sc
    where sc.id = p_salon_customer_id
      and sc.studio_id = p_studio_id
      and sc.user_id = v_client_package.client_id
      and sc.merged_into_id is null;
  end if;

  if not found then
    raise exception 'no active salon_customer in studio % matches client package owner', p_studio_id using errcode = '23514';
  end if;

  insert into public.pkg02_adjustment_requests (
    studio_id,
    location_id,
    client_package_id,
    salon_customer_id,
    package_id,
    requested_delta_credits,
    requested_value_delta_amount,
    currency,
    reason,
    maker_user_id,
    maker_actor_role,
    status,
    metadata
  ) values (
    p_studio_id,
    p_location_id,
    v_client_package.id,
    v_salon_customer.id,
    v_package.id,
    p_requested_delta_credits,
    case when p_requested_value_delta_amount is null then null else round(p_requested_value_delta_amount::numeric, 2) end,
    coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'SGD'),
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_actor_id,
    p_actor_role,
    'draft',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_request;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pkg02_adjustment_request_created',
    p_target_type := 'pkg02_adjustment_request',
    p_actor_type := 'user',
    p_location_id := v_request.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_request.id,
    p_before_state := null,
    p_after_state := to_jsonb(v_request)
  );

  insert into public.pkg02_approval_logs (
    request_id,
    studio_id,
    action,
    approval_role,
    actor_id,
    actor_role,
    from_status,
    to_status,
    note,
    metadata,
    audit_log_id
  ) values (
    v_request.id,
    p_studio_id,
    'draft_created',
    'maker',
    p_actor_id,
    p_actor_role,
    null,
    'draft',
    v_request.reason,
    coalesce(v_request.metadata, '{}'::jsonb),
    v_audit_id
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'version', v_request.version
  );
end;
$$;


create or replace function public.pkg02_submit_adjustment_request(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_request_id uuid,
  p_expected_version integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_request public.pkg02_adjustment_requests;
  v_request_after public.pkg02_adjustment_requests;
  v_audit_id uuid;
begin
  perform public.pkg02_assert_actor_scope(
    p_studio_id := p_studio_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_approval_role := 'maker'
  );

  select *
  into v_request
  from public.pkg02_adjustment_requests r
  where r.id = p_request_id
    and r.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'adjustment request % not found in studio %', p_request_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_request.maker_user_id <> p_actor_id then
    raise exception 'only maker can submit this request' using errcode = '42501';
  end if;

  if v_request.status <> 'draft' then
    raise exception 'request % is % and cannot be submitted', p_request_id, v_request.status using errcode = '23514';
  end if;

  if p_expected_version is not null and v_request.version <> p_expected_version then
    raise exception 'request % version conflict: expected % got %', p_request_id, p_expected_version, v_request.version using errcode = '40001';
  end if;

  update public.pkg02_adjustment_requests
  set status = 'submitted',
      submitted_at = now(),
      version = version + 1,
      updated_at = now()
  where id = v_request.id
  returning * into v_request_after;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'pkg02_adjustment_request_submitted',
    p_target_type := 'pkg02_adjustment_request',
    p_actor_type := 'user',
    p_location_id := v_request_after.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_request_after.id,
    p_before_state := to_jsonb(v_request),
    p_after_state := to_jsonb(v_request_after)
  );

  insert into public.pkg02_approval_logs (
    request_id,
    studio_id,
    action,
    approval_role,
    actor_id,
    actor_role,
    from_status,
    to_status,
    note,
    metadata,
    audit_log_id
  ) values (
    v_request_after.id,
    p_studio_id,
    'submitted',
    'maker',
    p_actor_id,
    p_actor_role,
    v_request.status,
    v_request_after.status,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('version', v_request_after.version),
    v_audit_id
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_after.id,
    'status', v_request_after.status,
    'version', v_request_after.version
  );
end;
$$;


create or replace function public.pkg02_decide_adjustment_request(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_request_id uuid,
  p_decision text,
  p_expected_version integer default null,
  p_rejection_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_request public.pkg02_adjustment_requests;
  v_request_after public.pkg02_adjustment_requests;
  v_decision text := lower(coalesce(p_decision, ''));
  v_audit_id uuid;
begin
  perform public.pkg02_assert_actor_scope(
    p_studio_id := p_studio_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_approval_role := 'checker'
  );

  if v_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;

  select *
  into v_request
  from public.pkg02_adjustment_requests r
  where r.id = p_request_id
    and r.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'adjustment request % not found in studio %', p_request_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_request.status <> 'submitted' then
    raise exception 'request % is % and cannot be decided', p_request_id, v_request.status using errcode = '23514';
  end if;

  if v_request.maker_user_id = p_actor_id then
    raise exception 'maker % cannot self-approve request %', p_actor_id, p_request_id using errcode = '42501';
  end if;

  if p_expected_version is not null and v_request.version <> p_expected_version then
    raise exception 'request % version conflict: expected % got %', p_request_id, p_expected_version, v_request.version using errcode = '40001';
  end if;

  if v_decision = 'approved' then
    update public.pkg02_adjustment_requests
    set status = 'approved',
        checker_user_id = p_actor_id,
        checker_actor_role = p_actor_role,
        approved_at = now(),
        rejection_reason = null,
        version = version + 1,
        updated_at = now()
    where id = v_request.id
    returning * into v_request_after;
  else
    update public.pkg02_adjustment_requests
    set status = 'rejected',
        checker_user_id = p_actor_id,
        checker_actor_role = p_actor_role,
        rejected_at = now(),
        rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
        version = version + 1,
        updated_at = now()
    where id = v_request.id
    returning * into v_request_after;
  end if;

  v_audit_id := public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := case when v_decision = 'approved' then 'pkg02_adjustment_request_approved' else 'pkg02_adjustment_request_rejected' end,
    p_target_type := 'pkg02_adjustment_request',
    p_actor_type := 'user',
    p_location_id := v_request_after.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_request_after.id,
    p_before_state := to_jsonb(v_request),
    p_after_state := to_jsonb(v_request_after)
  );

  insert into public.pkg02_approval_logs (
    request_id,
    studio_id,
    action,
    approval_role,
    actor_id,
    actor_role,
    from_status,
    to_status,
    note,
    metadata,
    audit_log_id
  ) values (
    v_request_after.id,
    p_studio_id,
    v_decision,
    'checker',
    p_actor_id,
    p_actor_role,
    v_request.status,
    v_request_after.status,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'version', v_request_after.version,
      'rejectionReason', v_request_after.rejection_reason
    ),
    v_audit_id
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_after.id,
    'status', v_request_after.status,
    'version', v_request_after.version
  );
end;
$$;


create or replace function public.pkg02_apply_adjustment_request(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_request_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_expected_version integer default null,
  p_note text default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claim jsonb;
  v_outcome text;
  v_idempotency_key_id uuid;
  v_idempotency_claim_token uuid;
  v_request public.pkg02_adjustment_requests;
  v_request_after public.pkg02_adjustment_requests;
  v_client_package public.client_packages;
  v_balance_before integer;
  v_balance_after integer;
  v_ledger_id uuid;
  v_audit_id uuid;
  v_result jsonb;
begin
  perform public.pkg02_assert_actor_scope(
    p_studio_id := p_studio_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_approval_role := 'checker'
  );

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'request_hash is required' using errcode = '22023';
  end if;

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := p_studio_id,
    p_operation_scope := 'pkg02_adjustment:apply',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'pkg02_apply_adjustment_request idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'pkg02_apply_adjustment_request unexpected idempotency outcome: %', v_outcome using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    select *
    into v_request
    from public.pkg02_adjustment_requests r
    where r.id = p_request_id
      and r.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'adjustment request % not found in studio %', p_request_id, p_studio_id using errcode = 'P0002';
    end if;

    if p_expected_version is not null and v_request.version <> p_expected_version then
      raise exception 'request % version conflict: expected % got %', p_request_id, p_expected_version, v_request.version using errcode = '40001';
    end if;

    if v_request.status = 'applied' and v_request.applied_ledger_entry_id is not null then
      v_result := jsonb_build_object(
        'ok', true,
        'already_applied', true,
        'request_id', v_request.id,
        'status', v_request.status,
        'ledger_entry_id', v_request.applied_ledger_entry_id,
        'version', v_request.version
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for pkg02_adjustment:apply' using errcode = '23514';
      end if;

      return v_result;
    end if;

    if v_request.status <> 'approved' then
      raise exception 'request % is % and cannot be applied', p_request_id, v_request.status using errcode = '23514';
    end if;

    if v_request.maker_user_id = p_actor_id then
      raise exception 'maker % cannot apply own request %', p_actor_id, p_request_id using errcode = '42501';
    end if;

    select *
    into v_client_package
    from public.client_packages cp
    where cp.id = v_request.client_package_id
    for update;

    if not found then
      raise exception 'client package % not found', v_request.client_package_id using errcode = 'P0002';
    end if;

    v_balance_before := coalesce(v_client_package.credits_left, 0);
    v_balance_after := v_balance_before + v_request.requested_delta_credits;

    if v_balance_after < 0 then
      raise exception 'insufficient credits for adjustment: before=% delta=% after=%',
        v_balance_before, v_request.requested_delta_credits, v_balance_after using errcode = '23514';
    end if;

    v_audit_id := public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pkg02_adjustment_request_applied',
      p_target_type := 'pkg02_adjustment_request',
      p_actor_type := 'user',
      p_location_id := v_request.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_request.id,
      p_before_state := jsonb_build_object(
        'requestStatus', v_request.status,
        'balanceBefore', v_balance_before,
        'version', v_request.version
      ),
      p_after_state := jsonb_build_object(
        'requestStatus', 'applied',
        'balanceAfter', v_balance_after,
        'deltaCredits', v_request.requested_delta_credits
      ),
      p_correlation_id := p_correlation_id,
      p_idempotency_key_id := v_idempotency_key_id
    );

    insert into public.client_package_ledger_entries (
      studio_id,
      location_id,
      client_package_id,
      salon_customer_id,
      package_id,
      event_type,
      source_type,
      source_id,
      delta_credits,
      balance_before,
      balance_after,
      currency,
      value_delta_amount,
      note,
      metadata,
      audit_log_id,
      idempotency_key_id,
      created_by,
      occurred_at
    ) values (
      p_studio_id,
      v_request.location_id,
      v_request.client_package_id,
      v_request.salon_customer_id,
      v_request.package_id,
      'manual_adjustment',
      'pkg02_adjustment_request',
      v_request.id,
      v_request.requested_delta_credits,
      v_balance_before,
      v_balance_after,
      v_request.currency,
      v_request.requested_value_delta_amount,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_request.reason),
      jsonb_build_object(
        'requestId', v_request.id,
        'makerUserId', v_request.maker_user_id,
        'checkerUserId', p_actor_id,
        'requestVersion', v_request.version
      ),
      v_audit_id,
      v_idempotency_key_id,
      p_actor_id,
      now()
    )
    returning id into v_ledger_id;

    update public.client_packages
    set credits_left = v_balance_after
    where id = v_client_package.id;

    update public.pkg02_adjustment_requests
    set status = 'applied',
        applied_at = now(),
        applied_ledger_entry_id = v_ledger_id,
        checker_user_id = coalesce(checker_user_id, p_actor_id),
        checker_actor_role = coalesce(checker_actor_role, p_actor_role),
        version = version + 1,
        updated_at = now()
    where id = v_request.id
    returning * into v_request_after;

    insert into public.pkg02_approval_logs (
      request_id,
      studio_id,
      action,
      approval_role,
      actor_id,
      actor_role,
      from_status,
      to_status,
      note,
      metadata,
      audit_log_id
    ) values (
      v_request_after.id,
      p_studio_id,
      'applied',
      'checker',
      p_actor_id,
      p_actor_role,
      v_request.status,
      v_request_after.status,
      nullif(btrim(coalesce(p_note, '')), ''),
      jsonb_build_object(
        'ledgerEntryId', v_ledger_id,
        'version', v_request_after.version,
        'idempotencyKeyId', v_idempotency_key_id
      ),
      v_audit_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'already_applied', false,
      'request_id', v_request_after.id,
      'status', v_request_after.status,
      'ledger_entry_id', v_ledger_id,
      'version', v_request_after.version
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pkg02_adjustment:apply' using errcode = '23514';
    end if;

    return v_result;
  exception
    when others then
      perform public.fail_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_error_summary := sqlstate || ': ' || sqlerrm,
        p_retryable := true
      );
      raise;
  end;
end;
$$;

revoke all on function public.pkg02_assert_actor_scope(uuid, uuid, text, text) from public;
revoke all on function public.pkg02_assert_actor_scope(uuid, uuid, text, text) from anon;
revoke all on function public.pkg02_assert_actor_scope(uuid, uuid, text, text) from authenticated;
grant execute on function public.pkg02_assert_actor_scope(uuid, uuid, text, text) to service_role;

revoke all on function public.pkg02_create_adjustment_request(uuid, text, uuid, uuid, integer, text, numeric, text, uuid, uuid, jsonb) from public;
revoke all on function public.pkg02_create_adjustment_request(uuid, text, uuid, uuid, integer, text, numeric, text, uuid, uuid, jsonb) from anon;
revoke all on function public.pkg02_create_adjustment_request(uuid, text, uuid, uuid, integer, text, numeric, text, uuid, uuid, jsonb) from authenticated;
grant execute on function public.pkg02_create_adjustment_request(uuid, text, uuid, uuid, integer, text, numeric, text, uuid, uuid, jsonb) to service_role;

revoke all on function public.pkg02_submit_adjustment_request(uuid, text, uuid, uuid, integer, text) from public;
revoke all on function public.pkg02_submit_adjustment_request(uuid, text, uuid, uuid, integer, text) from anon;
revoke all on function public.pkg02_submit_adjustment_request(uuid, text, uuid, uuid, integer, text) from authenticated;
grant execute on function public.pkg02_submit_adjustment_request(uuid, text, uuid, uuid, integer, text) to service_role;

revoke all on function public.pkg02_decide_adjustment_request(uuid, text, uuid, uuid, text, integer, text, text) from public;
revoke all on function public.pkg02_decide_adjustment_request(uuid, text, uuid, uuid, text, integer, text, text) from anon;
revoke all on function public.pkg02_decide_adjustment_request(uuid, text, uuid, uuid, text, integer, text, text) from authenticated;
grant execute on function public.pkg02_decide_adjustment_request(uuid, text, uuid, uuid, text, integer, text, text) to service_role;

revoke all on function public.pkg02_apply_adjustment_request(uuid, text, uuid, uuid, text, text, integer, text, text) from public;
revoke all on function public.pkg02_apply_adjustment_request(uuid, text, uuid, uuid, text, text, integer, text, text) from anon;
revoke all on function public.pkg02_apply_adjustment_request(uuid, text, uuid, uuid, text, text, integer, text, text) from authenticated;
grant execute on function public.pkg02_apply_adjustment_request(uuid, text, uuid, uuid, text, text, integer, text, text) to service_role;
