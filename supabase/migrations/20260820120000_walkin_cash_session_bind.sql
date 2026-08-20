-- Allow frontdesk class/event cash walk-in to bind cash_session_id
-- without creating a POS sale. Close till expected cash counts those rows.

create or replace function public.payment_is_cash_session_eligible(
  p_payment_method text,
  p_source text,
  p_sales_channel text
) returns boolean
language sql
immutable
as $$
  select
    coalesce(p_payment_method, '') = 'cash'
    and (
      coalesce(p_source, '') = 'pos_sale'
      or (
        coalesce(p_sales_channel, '') = 'frontdesk'
        and coalesce(p_source, '') in ('online_booking', 'event_booking')
      )
    );
$$;

revoke all on function public.payment_is_cash_session_eligible(text, text, text) from public;
revoke all on function public.payment_is_cash_session_eligible(text, text, text) from anon;
revoke all on function public.payment_is_cash_session_eligible(text, text, text) from authenticated;
grant execute on function public.payment_is_cash_session_eligible(text, text, text) to service_role;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_cash_session_method_source_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_cash_session_method_source_check;
  end if;
end $$;

alter table public.payments
add constraint payments_cash_session_method_source_check
check (
  cash_session_id is null
  or public.payment_is_cash_session_eligible(payment_method, source, sales_channel)
);

create or replace function public.payments_validate_cash_session_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.pos_cash_sessions;
begin
  if new.cash_session_id is null then
    return new;
  end if;

  if not public.payment_is_cash_session_eligible(new.payment_method, new.source, new.sales_channel) then
    raise exception 'cash_session_id requires cash till-eligible payment'
      using errcode = '23514';
  end if;

  select *
  into v_session
  from public.pos_cash_sessions s
  where s.id = new.cash_session_id;

  if not found then
    raise exception 'cash session % not found', new.cash_session_id using errcode = 'P0002';
  end if;

  if new.studio_id is distinct from v_session.studio_id then
    raise exception 'payment studio_id must match cash session studio_id' using errcode = '23514';
  end if;

  if new.location_id is null or new.location_id is distinct from v_session.location_id then
    raise exception 'payment location_id must match cash session location_id' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_validate_cash_session_refs_trg on public.payments;
create trigger payments_validate_cash_session_refs_trg
  before insert or update of cash_session_id, studio_id, location_id, payment_method, source, sales_channel on public.payments
  for each row execute function public.payments_validate_cash_session_refs();

create or replace function public.close_pos_cash_session(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_session_id uuid,
  p_counted_cash numeric,
  p_notes text default null,
  p_idempotency_key text default null,
  p_request_hash text default null
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
  v_session_before public.pos_cash_sessions;
  v_session_after public.pos_cash_sessions;
  v_counted_cash numeric(12,2);
  v_cash_in numeric(12,2);
  v_cash_out numeric(12,2);
  v_expected_cash numeric(12,2);
  v_cash_over_short numeric(12,2);
  v_now timestamptz;
  v_notes text;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'request_hash is required' using errcode = '22023';
  end if;

  if p_counted_cash is null then
    raise exception 'counted_cash is required' using errcode = '22023';
  end if;

  v_counted_cash := round(p_counted_cash::numeric, 2);
  if v_counted_cash < 0 then
    raise exception 'counted_cash must be >= 0' using errcode = '22023';
  end if;

  v_claim := public.claim_business_idempotency_key(
    p_studio_id := p_studio_id,
    p_operation_scope := 'pos_cash_session:close',
    p_idempotency_key := p_idempotency_key,
    p_request_hash := p_request_hash,
    p_stale_after_seconds := 300
  );

  if coalesce((v_claim->>'ok')::boolean, false) is false then
    raise exception 'close_pos_cash_session idempotency claim rejected: %', v_claim
      using errcode = '23514';
  end if;

  v_outcome := v_claim->>'outcome';
  if v_outcome = 'already_completed' then
    return coalesce(v_claim->'result', jsonb_build_object('ok', true, 'already_completed', true));
  end if;

  if v_outcome <> 'claimed' then
    raise exception 'close_pos_cash_session unexpected idempotency outcome: %', v_outcome using errcode = '23514';
  end if;

  v_idempotency_key_id := (v_claim->>'id')::uuid;
  v_idempotency_claim_token := (v_claim->>'claimToken')::uuid;

  begin
    select *
    into v_session_before
    from public.pos_cash_sessions s
    where s.id = p_session_id
      and s.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'cash session % not found in studio %', p_session_id, p_studio_id using errcode = 'P0002';
    end if;

    perform public.pos01_assert_actor_scope(
      p_studio_id := p_studio_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_location_id := v_session_before.location_id
    );

    if v_session_before.status = 'closed' then
      v_result := jsonb_build_object(
        'ok', true,
        'session_id', v_session_before.id,
        'studio_id', v_session_before.studio_id,
        'location_id', v_session_before.location_id,
        'status', v_session_before.status,
        'opened_at', v_session_before.opened_at,
        'closed_at', v_session_before.closed_at,
        'opening_float', v_session_before.opening_float,
        'cash_in', v_session_before.cash_in,
        'cash_out', v_session_before.cash_out,
        'expected_cash', v_session_before.expected_cash,
        'counted_cash', v_session_before.counted_cash,
        'cash_over_short', v_session_before.cash_over_short,
        'already_closed', true,
        'already_completed', false
      );

      if coalesce((public.complete_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_result_snapshot := v_result
      )->>'ok')::boolean, false) is false then
        raise exception 'idempotency claim token is not current for pos_cash_session:close' using errcode = '23514';
      end if;

      return v_result;
    end if;

    if v_session_before.status <> 'open' then
      raise exception 'cash session % status % cannot be closed', v_session_before.id, v_session_before.status
        using errcode = '23514';
    end if;

    select
      round(coalesce(sum(case when p.status in ('paid', 'refunded') then coalesce(p.amount, 0) else 0 end), 0)::numeric, 2),
      round(coalesce(sum(case when p.status = 'refunded' then coalesce(p.amount, 0) else 0 end), 0)::numeric, 2)
    into
      v_cash_in,
      v_cash_out
    from public.payments p
    where p.studio_id = p_studio_id
      and p.cash_session_id = v_session_before.id
      and public.payment_is_cash_session_eligible(p.payment_method, p.source, p.sales_channel);

    v_expected_cash := round((coalesce(v_session_before.opening_float, 0) + coalesce(v_cash_in, 0) - coalesce(v_cash_out, 0))::numeric, 2);
    v_cash_over_short := round((v_counted_cash - v_expected_cash)::numeric, 2);
    v_now := now();
    v_notes := nullif(btrim(coalesce(p_notes, '')), '');

    update public.pos_cash_sessions
    set cash_in = v_cash_in,
        cash_out = v_cash_out,
        expected_cash = v_expected_cash,
        counted_cash = v_counted_cash,
        cash_over_short = v_cash_over_short,
        status = 'closed',
        closed_at = v_now,
        closed_by = p_actor_id,
        notes = coalesce(v_notes, notes)
    where id = v_session_before.id
    returning * into v_session_after;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'pos_cash_session_closed',
      p_target_type := 'pos_cash_session',
      p_actor_type := 'user',
      p_location_id := v_session_before.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_session_before.id,
      p_before_state := to_jsonb(v_session_before),
      p_after_state := jsonb_build_object(
        'session', to_jsonb(v_session_after),
        'from_status', v_session_before.status,
        'to_status', v_session_after.status
      ),
      p_idempotency_key_id := v_idempotency_key_id
    );

    v_result := jsonb_build_object(
      'ok', true,
      'session_id', v_session_after.id,
      'studio_id', v_session_after.studio_id,
      'location_id', v_session_after.location_id,
      'status', v_session_after.status,
      'opened_at', v_session_after.opened_at,
      'closed_at', v_session_after.closed_at,
      'opening_float', v_session_after.opening_float,
      'cash_in', v_session_after.cash_in,
      'cash_out', v_session_after.cash_out,
      'expected_cash', v_session_after.expected_cash,
      'counted_cash', v_session_after.counted_cash,
      'cash_over_short', v_session_after.cash_over_short,
      'already_closed', false,
      'already_completed', false
    );

    if coalesce((public.complete_business_idempotency_key(
      p_id := v_idempotency_key_id,
      p_claim_token := v_idempotency_claim_token,
      p_result_snapshot := v_result
    )->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for pos_cash_session:close' using errcode = '23514';
    end if;

    return v_result;
  exception
    when others then
      perform public.fail_business_idempotency_key(
        p_id := v_idempotency_key_id,
        p_claim_token := v_idempotency_claim_token,
        p_error_summary := left(sqlerrm, 1000),
        p_retryable := true
      );
      raise;
  end;
end;
$$;
