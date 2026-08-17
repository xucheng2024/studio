-- MKT-02: idempotent campaign dispatch, Resend events, retries and reporting.

alter table public.marketing_campaigns
  add column scheduled_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column last_error text;

alter table public.marketing_campaign_recipients
  add column dispatch_status text not null default 'not_scheduled'
    check (dispatch_status in ('not_scheduled', 'pending', 'processing', 'retry_wait', 'submitted', 'delivered', 'failed', 'bounced', 'complained', 'suppressed', 'skipped')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz,
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column dispatch_batch_id uuid,
  add column provider_email_id text,
  add column last_error text,
  add column submitted_at timestamptz,
  add column delivered_at timestamptz,
  add column first_clicked_at timestamptz;

create unique index marketing_campaign_recipients_provider_email_idx
  on public.marketing_campaign_recipients (provider_email_id)
  where provider_email_id is not null;
create index marketing_campaign_recipients_dispatch_idx
  on public.marketing_campaign_recipients (campaign_id, dispatch_status, next_attempt_at);

create table public.marketing_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  recipient_id uuid not null references public.marketing_campaign_recipients(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  target_url text not null check (target_url ~ '^https://'),
  click_count integer not null default 0 check (click_count >= 0),
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id)
);

create table public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  recipient_id uuid not null references public.marketing_campaign_recipients(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  provider text not null check (provider in ('resend', 'studio')),
  provider_event_id text not null,
  event_type text not null check (event_type in ('submitted', 'sent', 'delivered', 'delivery_delayed', 'failed', 'bounced', 'complained', 'suppressed', 'clicked', 'unsubscribed')),
  provider_email_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index marketing_campaign_events_campaign_time_idx
  on public.marketing_campaign_events (campaign_id, occurred_at desc);

create or replace function public.mkt02_validate_evidence_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.marketing_campaign_recipients r
    join public.marketing_campaigns c on c.id = r.campaign_id
    where r.id = new.recipient_id and r.campaign_id = new.campaign_id
      and r.studio_id = new.studio_id and c.studio_id = new.studio_id
  ) then
    raise exception 'marketing evidence must match recipient campaign scope' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mkt02_link_scope_trg
  before insert or update of campaign_id, recipient_id, studio_id on public.marketing_links
  for each row execute function public.mkt02_validate_evidence_scope();
create trigger mkt02_event_scope_trg
  before insert or update of campaign_id, recipient_id, studio_id on public.marketing_campaign_events
  for each row execute function public.mkt02_validate_evidence_scope();

create or replace function public.mkt02_schedule_campaign(
  p_campaign_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign public.marketing_campaigns%rowtype;
  v_ready integer;
begin
  select * into v_campaign from public.marketing_campaigns where id = p_campaign_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.mkt01_assert_actor_scope(v_campaign.studio_id, p_actor_id, p_actor_role, v_campaign.location_id);
  if v_campaign.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'not_draft'); end if;
  if p_scheduled_at > now() + interval '366 days' then return jsonb_build_object('ok', false, 'reason', 'schedule_too_far'); end if;

  update public.marketing_campaign_recipients r
  set eligibility = case
        when nullif(btrim(coalesce(r.email_snapshot, '')), '') is null
          or r.email_snapshot !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'missing_email'
        when exists (select 1 from public.marketing_suppressions s where s.studio_id = r.studio_id and s.channel = 'email' and s.email = lower(btrim(r.email_snapshot))) then 'suppressed'
        when not exists (
          select 1 from public.salon_customer_consents c
          where c.studio_id = r.studio_id and c.salon_customer_id = r.salon_customer_id
            and c.consent_key = 'email_marketing' and c.channel = 'email' and c.status = 'granted'
            and not exists (
              select 1 from public.salon_customer_consents newer
              where newer.studio_id = c.studio_id and newer.salon_customer_id = c.salon_customer_id
                and newer.consent_key = c.consent_key and newer.channel = c.channel
                and (newer.occurred_at, newer.created_at, newer.id) > (c.occurred_at, c.created_at, c.id)
            )
        ) then 'no_consent'
        else r.eligibility
      end,
      dispatch_status = case when r.eligibility = 'eligible' then 'pending' else 'skipped' end,
      next_attempt_at = case when r.eligibility = 'eligible' then greatest(coalesce(p_scheduled_at, now()), now()) else null end
  where r.campaign_id = p_campaign_id;

  -- The SET expression sees the old eligibility, so normalize rows excluded above.
  update public.marketing_campaign_recipients
  set dispatch_status = 'skipped', next_attempt_at = null
  where campaign_id = p_campaign_id and eligibility <> 'eligible';

  if v_campaign.cta_url is not null then
    insert into public.marketing_links (campaign_id, recipient_id, studio_id, target_url)
    select r.campaign_id, r.id, r.studio_id, v_campaign.cta_url
    from public.marketing_campaign_recipients r
    where r.campaign_id = p_campaign_id and r.eligibility = 'eligible'
    on conflict (recipient_id) do nothing;
  end if;

  select count(*) into v_ready from public.marketing_campaign_recipients
  where campaign_id = p_campaign_id and dispatch_status = 'pending';
  update public.marketing_campaigns
  set status = case when v_ready = 0 then 'complete' else 'scheduled' end,
      scheduled_at = greatest(coalesce(p_scheduled_at, now()), now()),
      completed_at = case when v_ready = 0 then now() else null end,
      last_error = null, updated_at = now()
  where id = p_campaign_id;

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, after_state)
  values (p_actor_id, p_actor_role, 'marketing_campaign_scheduled', 'marketing_campaign', p_campaign_id,
    jsonb_build_object('scheduled_at', greatest(coalesce(p_scheduled_at, now()), now()), 'ready_count', v_ready));
  return jsonb_build_object('ok', true, 'ready_count', v_ready);
end;
$$;

create or replace function public.mkt02_claim_dispatch_batch(
  p_batch_size integer default 50,
  p_stale_after_seconds integer default 300,
  p_max_attempts integer default 5
)
returns table (
  recipient_id uuid, campaign_id uuid, studio_id uuid, location_id uuid,
  email_snapshot text, full_name_snapshot text, unsubscribe_token uuid,
  claim_token uuid, dispatch_batch_id uuid, attempt_count integer,
  subject text, body text, image_url text, cta_label text, click_token uuid, studio_name text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign_id uuid;
  v_batch_id uuid;
  v_claim_token uuid := gen_random_uuid();
begin
  if p_batch_size < 1 or p_batch_size > 100 or p_stale_after_seconds < 1 or p_max_attempts < 1 then
    raise exception 'invalid dispatch claim limits' using errcode = '22023';
  end if;

  update public.marketing_campaign_recipients r
  set dispatch_status = 'failed', claim_token = null, claimed_at = null, dispatch_batch_id = null,
      next_attempt_at = null, last_error = coalesce(last_error, 'dispatch outcome could not be reconciled')
  where r.dispatch_status = 'processing' and r.attempt_count >= p_max_attempts
    and r.claimed_at < now() - make_interval(secs => p_stale_after_seconds);
  update public.marketing_campaigns c
  set status = 'complete', completed_at = now(), updated_at = now()
  where c.status = 'sending'
    and not exists (select 1 from public.marketing_campaign_recipients r where r.campaign_id = c.id and r.dispatch_status in ('pending', 'retry_wait', 'processing'));

  select c.id into v_campaign_id
  from public.marketing_campaigns c
  where c.status in ('scheduled', 'sending') and c.scheduled_at <= now()
    and exists (
      select 1 from public.marketing_campaign_recipients r
      where r.campaign_id = c.id and (
        (r.dispatch_status in ('pending', 'retry_wait') and coalesce(r.next_attempt_at, now()) <= now() and r.attempt_count < p_max_attempts)
        or (r.dispatch_status = 'processing' and r.claimed_at < now() - make_interval(secs => p_stale_after_seconds))
      )
    )
  order by c.scheduled_at, c.created_at
  for update skip locked limit 1;
  if v_campaign_id is null then return; end if;

  -- Re-check consent and suppression before a new provider request. A stale processing
  -- batch is intentionally replayed unchanged with its original idempotency key.
  update public.marketing_campaign_recipients r
  set eligibility = case
        when exists (select 1 from public.marketing_suppressions s where s.studio_id = r.studio_id and s.channel = 'email' and s.email = lower(btrim(r.email_snapshot))) then 'suppressed'
        when not exists (
          select 1 from public.salon_customer_consents c
          where c.studio_id = r.studio_id and c.salon_customer_id = r.salon_customer_id
            and c.consent_key = 'email_marketing' and c.channel = 'email' and c.status = 'granted'
            and not exists (
              select 1 from public.salon_customer_consents newer
              where newer.studio_id = c.studio_id and newer.salon_customer_id = c.salon_customer_id
                and newer.consent_key = c.consent_key and newer.channel = c.channel
                and (newer.occurred_at, newer.created_at, newer.id) > (c.occurred_at, c.created_at, c.id)
            )
        ) then 'no_consent'
        else r.eligibility
      end
  where r.campaign_id = v_campaign_id and r.dispatch_status in ('pending', 'retry_wait');
  update public.marketing_campaign_recipients r
  set dispatch_status = 'skipped', next_attempt_at = null
  where r.campaign_id = v_campaign_id and r.dispatch_status in ('pending', 'retry_wait') and r.eligibility <> 'eligible';

  if not exists (
    select 1 from public.marketing_campaign_recipients r
    where r.campaign_id = v_campaign_id and (
      (r.dispatch_status in ('pending', 'retry_wait') and coalesce(r.next_attempt_at, now()) <= now() and r.attempt_count < p_max_attempts)
      or (r.dispatch_status = 'processing' and r.claimed_at < now() - make_interval(secs => p_stale_after_seconds))
    )
  ) then
    if not exists (select 1 from public.marketing_campaign_recipients r where r.campaign_id = v_campaign_id and r.dispatch_status in ('pending', 'retry_wait', 'processing')) then
      update public.marketing_campaigns set status = 'complete', completed_at = now(), updated_at = now() where id = v_campaign_id;
    end if;
    return;
  end if;

  select r.dispatch_batch_id into v_batch_id
  from public.marketing_campaign_recipients r
  where r.campaign_id = v_campaign_id and r.dispatch_status = 'processing'
    and r.claimed_at < now() - make_interval(secs => p_stale_after_seconds)
  order by r.claimed_at limit 1;

  if v_batch_id is null then
    v_batch_id := gen_random_uuid();
    with candidates as (
      select r.id from public.marketing_campaign_recipients r
      where r.campaign_id = v_campaign_id and r.eligibility = 'eligible'
        and r.dispatch_status in ('pending', 'retry_wait')
        and coalesce(r.next_attempt_at, now()) <= now() and r.attempt_count < p_max_attempts
      order by r.created_at for update skip locked limit p_batch_size
    )
    update public.marketing_campaign_recipients r
    set dispatch_status = 'processing', claim_token = v_claim_token, claimed_at = now(),
        dispatch_batch_id = v_batch_id, attempt_count = r.attempt_count + 1, last_error = null
    from candidates x where r.id = x.id;
  else
    update public.marketing_campaign_recipients r
    set claim_token = v_claim_token, claimed_at = now(), attempt_count = r.attempt_count + 1
    where r.campaign_id = v_campaign_id and r.dispatch_batch_id = v_batch_id and r.dispatch_status = 'processing';
  end if;

  update public.marketing_campaigns set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_campaign_id;

  return query
  select r.id, r.campaign_id, r.studio_id, c.location_id, r.email_snapshot, r.full_name_snapshot,
    r.unsubscribe_token, r.claim_token, r.dispatch_batch_id, r.attempt_count,
    c.subject, c.body, c.image_url, c.cta_label, l.token, s.name
  from public.marketing_campaign_recipients r
  join public.marketing_campaigns c on c.id = r.campaign_id
  join public.studios s on s.id = r.studio_id
  left join public.marketing_links l on l.recipient_id = r.id
  where r.campaign_id = v_campaign_id and r.dispatch_batch_id = v_batch_id
    and r.dispatch_status = 'processing' and r.claim_token = v_claim_token
  order by r.created_at;
end;
$$;

create or replace function public.mkt02_complete_dispatch_batch(
  p_recipient_ids uuid[], p_provider_email_ids text[], p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_campaign_id uuid; v_updated integer;
begin
  if cardinality(p_recipient_ids) is distinct from cardinality(p_provider_email_ids) or cardinality(p_recipient_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_mapping');
  end if;
  select campaign_id into v_campaign_id from public.marketing_campaign_recipients
  where id = p_recipient_ids[1] and claim_token = p_claim_token and dispatch_status = 'processing';
  if v_campaign_id is null then return jsonb_build_object('ok', false, 'reason', 'not_current_claim'); end if;

  with mapped as (select * from unnest(p_recipient_ids, p_provider_email_ids) as x(recipient_id, provider_email_id))
  update public.marketing_campaign_recipients r
  set dispatch_status = 'submitted', provider_email_id = m.provider_email_id,
      submitted_at = now(), next_attempt_at = null, claimed_at = null, claim_token = null, last_error = null
  from mapped m
  where r.id = m.recipient_id and r.campaign_id = v_campaign_id
    and r.claim_token = p_claim_token and r.dispatch_status = 'processing';
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_recipient_ids) then raise exception 'dispatch completion mapping was not atomic'; end if;

  insert into public.marketing_campaign_events (campaign_id, recipient_id, studio_id, provider, provider_event_id, event_type, provider_email_id, occurred_at)
  select r.campaign_id, r.id, r.studio_id, 'studio', 'submitted:' || r.id::text, 'submitted', r.provider_email_id, coalesce(r.submitted_at, now())
  from public.marketing_campaign_recipients r where r.id = any(p_recipient_ids)
  on conflict (provider, provider_event_id) do nothing;

  if not exists (select 1 from public.marketing_campaign_recipients where campaign_id = v_campaign_id and dispatch_status in ('pending', 'retry_wait', 'processing')) then
    update public.marketing_campaigns set status = 'complete', completed_at = now(), updated_at = now() where id = v_campaign_id;
  end if;
  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;

create or replace function public.mkt02_fail_dispatch_batch(
  p_recipient_ids uuid[], p_claim_token uuid, p_error_summary text,
  p_retryable boolean default true, p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_campaign_id uuid; v_retry_count integer; v_failed_count integer;
begin
  select campaign_id into v_campaign_id from public.marketing_campaign_recipients
  where id = p_recipient_ids[1] and claim_token = p_claim_token and dispatch_status = 'processing';
  if v_campaign_id is null then return jsonb_build_object('ok', false, 'reason', 'not_current_claim'); end if;
  update public.marketing_campaign_recipients
  set dispatch_status = case when p_retryable and attempt_count < p_max_attempts then 'retry_wait' else 'failed' end,
      next_attempt_at = case when p_retryable and attempt_count < p_max_attempts
        then now() + make_interval(secs => least(3600, 60 * (2 ^ greatest(attempt_count - 1, 0))::integer)) else null end,
      dispatch_batch_id = null, claim_token = null, claimed_at = null, last_error = left(p_error_summary, 1000)
  where id = any(p_recipient_ids) and campaign_id = v_campaign_id
    and claim_token = p_claim_token and dispatch_status = 'processing';
  get diagnostics v_retry_count = row_count;
  select count(*) into v_failed_count from public.marketing_campaign_recipients
  where campaign_id = v_campaign_id and dispatch_status = 'failed';
  if not p_retryable then
    update public.marketing_campaigns set status = 'failed', last_error = left(p_error_summary, 1000), updated_at = now() where id = v_campaign_id;
  elsif not exists (select 1 from public.marketing_campaign_recipients where campaign_id = v_campaign_id and dispatch_status in ('pending', 'retry_wait', 'processing')) then
    update public.marketing_campaigns set status = 'complete', completed_at = now(), updated_at = now() where id = v_campaign_id;
  end if;
  return jsonb_build_object('ok', true, 'updated', v_retry_count, 'permanent_failures', v_failed_count);
end;
$$;

create or replace function public.mkt02_retry_campaign(
  p_campaign_id uuid, p_actor_id uuid, p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_campaign public.marketing_campaigns%rowtype; v_count integer;
begin
  select * into v_campaign from public.marketing_campaigns where id = p_campaign_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.mkt01_assert_actor_scope(v_campaign.studio_id, p_actor_id, p_actor_role, v_campaign.location_id);
  update public.marketing_campaign_recipients r
  set dispatch_status = 'pending', attempt_count = 0, next_attempt_at = now(), last_error = null, dispatch_batch_id = null
  where r.campaign_id = p_campaign_id and r.dispatch_status = 'failed' and r.eligibility = 'eligible'
    and r.last_error is distinct from 'dispatch outcome could not be reconciled'
    and not exists (select 1 from public.marketing_suppressions s where s.studio_id = r.studio_id and s.email = lower(btrim(r.email_snapshot)));
  get diagnostics v_count = row_count;
  if v_count > 0 then update public.marketing_campaigns set status = 'scheduled', scheduled_at = now(), completed_at = null, last_error = null, updated_at = now() where id = p_campaign_id; end if;
  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, after_state)
  values (p_actor_id, p_actor_role, 'marketing_campaign_retry_requested', 'marketing_campaign', p_campaign_id, jsonb_build_object('retry_count', v_count));
  return jsonb_build_object('ok', true, 'retry_count', v_count);
end;
$$;

create or replace function public.mkt02_apply_resend_event(
  p_provider_event_id text, p_provider_email_id text, p_event_type text,
  p_occurred_at timestamptz, p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_recipient public.marketing_campaign_recipients%rowtype; v_reason text;
begin
  select * into v_recipient from public.marketing_campaign_recipients where provider_email_id = p_provider_email_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_email'); end if;
  if p_event_type not in ('sent', 'delivered', 'delivery_delayed', 'failed', 'bounced', 'complained', 'suppressed', 'clicked') then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_event');
  end if;
  insert into public.marketing_campaign_events (campaign_id, recipient_id, studio_id, provider, provider_event_id, event_type, provider_email_id, metadata, occurred_at)
  values (v_recipient.campaign_id, v_recipient.id, v_recipient.studio_id, 'resend', p_provider_event_id, p_event_type, p_provider_email_id, coalesce(p_metadata, '{}'::jsonb), p_occurred_at)
  on conflict (provider, provider_event_id) do nothing;

  update public.marketing_campaign_recipients
  set dispatch_status = case
        when p_event_type = 'delivered' and dispatch_status not in ('bounced', 'complained', 'suppressed') then 'delivered'
        when p_event_type = 'failed' and dispatch_status not in ('delivered', 'bounced', 'complained', 'suppressed') then 'failed'
        when p_event_type = 'bounced' then 'bounced'
        when p_event_type = 'complained' then 'complained'
        when p_event_type = 'suppressed' then 'suppressed'
        else dispatch_status end,
      delivered_at = case when p_event_type = 'delivered' then coalesce(delivered_at, p_occurred_at) else delivered_at end,
      first_clicked_at = case when p_event_type = 'clicked' and coalesce(p_metadata->>'link', '') like '%/r/c/%' then coalesce(first_clicked_at, p_occurred_at) else first_clicked_at end,
      last_error = case when p_event_type in ('failed', 'bounced', 'complained', 'suppressed') then left(coalesce(p_metadata->>'reason', p_event_type), 1000) else last_error end
  where id = v_recipient.id;

  if p_event_type in ('bounced', 'complained', 'suppressed') then
    v_reason := case when p_event_type = 'complained' then 'complaint' else 'bounce' end;
    insert into public.marketing_suppressions (studio_id, email, salon_customer_id, reason, occurred_at)
    values (v_recipient.studio_id, lower(btrim(v_recipient.email_snapshot)), v_recipient.salon_customer_id, v_reason, p_occurred_at)
    on conflict (studio_id, channel, email) do update
      set reason = case
          when public.marketing_suppressions.reason = 'unsubscribed' then 'unsubscribed'
          when excluded.reason = 'complaint' then 'complaint'
          else excluded.reason end,
        occurred_at = excluded.occurred_at;
  end if;
  return jsonb_build_object('ok', true, 'campaign_id', v_recipient.campaign_id, 'studio_id', v_recipient.studio_id);
end;
$$;

create or replace function public.mkt02_record_click(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_link public.marketing_links%rowtype;
begin
  select * into v_link from public.marketing_links where token = p_token for update;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.marketing_links set click_count = click_count + 1,
    first_clicked_at = coalesce(first_clicked_at, now()), last_clicked_at = now() where id = v_link.id;
  update public.marketing_campaign_recipients set first_clicked_at = coalesce(first_clicked_at, now()) where id = v_link.recipient_id;
  insert into public.marketing_campaign_events (campaign_id, recipient_id, studio_id, provider, provider_event_id, event_type, occurred_at)
  values (v_link.campaign_id, v_link.recipient_id, v_link.studio_id, 'studio', 'clicked:' || v_link.id::text, 'clicked', now())
  on conflict (provider, provider_event_id) do nothing;
  return jsonb_build_object('ok', true, 'target_url', v_link.target_url);
end;
$$;

alter table public.marketing_links enable row level security;
alter table public.marketing_campaign_events enable row level security;
revoke all on public.marketing_links, public.marketing_campaign_events from public, anon, authenticated;
grant select, insert, update on public.marketing_links, public.marketing_campaign_events to service_role;

revoke all on function public.mkt02_schedule_campaign(uuid, uuid, text, timestamptz),
  public.mkt02_claim_dispatch_batch(integer, integer, integer),
  public.mkt02_complete_dispatch_batch(uuid[], text[], uuid),
  public.mkt02_fail_dispatch_batch(uuid[], uuid, text, boolean, integer),
  public.mkt02_retry_campaign(uuid, uuid, text),
  public.mkt02_apply_resend_event(text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.mkt02_validate_evidence_scope() from public, anon, authenticated;
grant execute on function public.mkt02_schedule_campaign(uuid, uuid, text, timestamptz),
  public.mkt02_claim_dispatch_batch(integer, integer, integer),
  public.mkt02_complete_dispatch_batch(uuid[], text[], uuid),
  public.mkt02_fail_dispatch_batch(uuid[], uuid, text, boolean, integer),
  public.mkt02_retry_campaign(uuid, uuid, text),
  public.mkt02_apply_resend_event(text, text, text, timestamptz, jsonb)
  to service_role;
grant execute on function public.mkt02_validate_evidence_scope() to service_role;
revoke all on function public.mkt02_record_click(uuid) from public, authenticated;
grant execute on function public.mkt02_record_click(uuid) to anon, service_role;

create or replace function public.mkt01_unsubscribe_recipient(p_token uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recipient public.marketing_campaign_recipients%rowtype;
begin
  select * into v_recipient from public.marketing_campaign_recipients where unsubscribe_token = p_token for update;
  if not found or nullif(btrim(coalesce(v_recipient.email_snapshot, '')), '') is null then return; end if;
  insert into public.marketing_suppressions (studio_id, email, salon_customer_id, reason)
  values (v_recipient.studio_id, lower(btrim(v_recipient.email_snapshot)), v_recipient.salon_customer_id, 'unsubscribed')
  on conflict (studio_id, channel, email) do update set reason = 'unsubscribed', occurred_at = now();
  update public.marketing_campaign_recipients
  set eligibility = 'unsubscribed',
      dispatch_status = case when dispatch_status in ('not_scheduled', 'pending', 'retry_wait') then 'skipped' else dispatch_status end,
      next_attempt_at = case when dispatch_status in ('not_scheduled', 'pending', 'retry_wait') then null else next_attempt_at end
  where id = v_recipient.id;
  insert into public.marketing_campaign_events (campaign_id, recipient_id, studio_id, provider, provider_event_id, event_type, occurred_at)
  values (v_recipient.campaign_id, v_recipient.id, v_recipient.studio_id, 'studio', 'unsubscribed:' || v_recipient.id::text, 'unsubscribed', now())
  on conflict (provider, provider_event_id) do nothing;
end;
$$;
