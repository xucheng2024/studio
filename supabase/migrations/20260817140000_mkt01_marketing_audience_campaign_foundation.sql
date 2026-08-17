-- MKT-01: consent-safe audience, campaign draft and recipient snapshot foundation.
-- This migration deliberately does not implement campaign dispatch, provider webhooks,
-- click tracking, or reporting (MKT-02).

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  audience_type text not null check (audience_type in ('vip', 'frequent', 'inactive')),
  audience_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(audience_rules) = 'object'),
  subject text not null check (char_length(btrim(subject)) between 1 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  image_url text,
  cta_label text,
  cta_url text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'complete', 'cancelled', 'failed')),
  recipient_snapshot_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaigns_cta_pair check (
    (cta_label is null and cta_url is null)
    or (char_length(btrim(coalesce(cta_label, ''))) between 1 and 80 and cta_url ~ '^https://')
  )
);

create index marketing_campaigns_studio_created_idx
  on public.marketing_campaigns (studio_id, created_at desc);

create table public.marketing_suppressions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 320),
  channel text not null default 'email' check (channel = 'email'),
  reason text not null check (reason in ('unsubscribed', 'bounce', 'complaint', 'manual')),
  salon_customer_id uuid references public.salon_customers(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (studio_id, channel, email)
);

create index marketing_suppressions_customer_idx
  on public.marketing_suppressions (studio_id, salon_customer_id)
  where salon_customer_id is not null;

create table public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  email_snapshot text,
  full_name_snapshot text,
  consent_event_id uuid references public.salon_customer_consents(id) on delete set null,
  eligibility text not null check (eligibility in ('eligible', 'no_consent', 'suppressed', 'missing_email', 'unsubscribed')),
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (campaign_id, salon_customer_id)
);

create index marketing_campaign_recipients_campaign_eligibility_idx
  on public.marketing_campaign_recipients (campaign_id, eligibility);

create or replace function public.mkt01_assert_actor_scope(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_actor_role not in ('owner', 'manager') then
    raise exception 'marketing requires owner or manager' using errcode = '42501';
  end if;

  if p_actor_role = 'owner' and exists (
    select 1 from public.studios where id = p_studio_id and owner_id = p_actor_id
  ) then
    if p_location_id is null or exists (
      select 1 from public.locations where id = p_location_id and studio_id = p_studio_id
    ) then return; end if;
  end if;

  if p_location_id is null then
    if exists (
      select 1 from public.staff_memberships
      where user_id = p_actor_id and studio_id = p_studio_id and role = p_actor_role
        and is_active and location_id is null
    ) then return; end if;
  elsif exists (
    select 1 from public.staff_memberships
    where user_id = p_actor_id and studio_id = p_studio_id and role = p_actor_role
      and is_active and (location_id is null or location_id = p_location_id)
  ) and exists (select 1 from public.locations where id = p_location_id and studio_id = p_studio_id) then
    return;
  end if;

  raise exception 'actor has no marketing scope for this studio/location' using errcode = '42501';
end;
$$;

create or replace function public.mkt01_create_campaign_snapshot(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_name text,
  p_audience_type text,
  p_min_value numeric default 1000,
  p_min_visits integer default 3,
  p_inactive_days integer default 90,
  p_subject text default '',
  p_body text default '',
  p_image_url text default null,
  p_cta_label text default null,
  p_cta_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign_id uuid;
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_inactive_days, 1));
  v_eligible_count integer;
  v_total_count integer;
begin
  perform public.mkt01_assert_actor_scope(p_studio_id, p_actor_id, p_actor_role, p_location_id);
  if p_audience_type not in ('vip', 'frequent', 'inactive') then
    raise exception 'invalid audience type' using errcode = '22023';
  end if;
  if p_min_value < 0 or p_min_visits < 1 or p_inactive_days < 1 then
    raise exception 'audience thresholds are invalid' using errcode = '22023';
  end if;

  insert into public.marketing_campaigns (
    studio_id, location_id, name, audience_type, audience_rules, subject, body, image_url, cta_label, cta_url, created_by, recipient_snapshot_at
  ) values (
    p_studio_id, p_location_id, btrim(p_name), p_audience_type,
    jsonb_build_object('min_value', p_min_value, 'min_visits', p_min_visits, 'inactive_days', p_inactive_days),
    btrim(p_subject), p_body, nullif(btrim(p_image_url), ''), nullif(btrim(p_cta_label), ''), nullif(btrim(p_cta_url), ''), p_actor_id, now()
  ) returning id into v_campaign_id;

  with candidates as (
    select c.id, c.email, c.full_name,
      (
        select sc.id from public.salon_customer_consents sc
        where sc.studio_id = c.studio_id and sc.salon_customer_id = c.id
          and sc.consent_key = 'email_marketing' and sc.channel = 'email'
        order by sc.occurred_at desc, sc.created_at desc limit 1
      ) as consent_event_id,
      (
        select sc.status from public.salon_customer_consents sc
        where sc.studio_id = c.studio_id and sc.salon_customer_id = c.id
          and sc.consent_key = 'email_marketing' and sc.channel = 'email'
        order by sc.occurred_at desc, sc.created_at desc limit 1
      ) as consent_status
    from public.salon_customers c
    where c.studio_id = p_studio_id and c.status = 'active' and c.merged_into_id is null
      and (p_location_id is null or exists (
        select 1 from public.salon_appointments a where a.studio_id = p_studio_id and a.salon_customer_id = c.id and a.location_id = p_location_id
        union all
        select 1 from public.pos_sales s where s.studio_id = p_studio_id and s.salon_customer_id = c.id and s.location_id = p_location_id
      ))
      and case p_audience_type
        when 'vip' then coalesce((select sum(s.total_amount - s.refunded_amount) from public.pos_sales s where s.studio_id = p_studio_id and s.salon_customer_id = c.id and s.status in ('paid', 'partially_refunded', 'refunded') and (p_location_id is null or s.location_id = p_location_id)), 0) >= p_min_value
        when 'frequent' then (select count(*) from public.salon_appointments a where a.studio_id = p_studio_id and a.salon_customer_id = c.id and a.status = 'completed' and (p_location_id is null or a.location_id = p_location_id)) >= p_min_visits
        when 'inactive' then exists (select 1 from public.salon_appointments a where a.studio_id = p_studio_id and a.salon_customer_id = c.id and a.status = 'completed' and (p_location_id is null or a.location_id = p_location_id))
          and coalesce((select max(a.starts_at) from public.salon_appointments a where a.studio_id = p_studio_id and a.salon_customer_id = c.id and a.status = 'completed' and (p_location_id is null or a.location_id = p_location_id)), now()) < v_cutoff
      end
  )
  insert into public.marketing_campaign_recipients (campaign_id, studio_id, salon_customer_id, email_snapshot, full_name_snapshot, consent_event_id, eligibility)
  select v_campaign_id, p_studio_id, c.id, lower(btrim(c.email)), c.full_name, c.consent_event_id,
    case
      when nullif(btrim(coalesce(c.email, '')), '') is null then 'missing_email'
      when exists (select 1 from public.marketing_suppressions ms where ms.studio_id = p_studio_id and ms.channel = 'email' and ms.email = lower(btrim(c.email))) then 'suppressed'
      when c.consent_status = 'granted' then 'eligible'
      else 'no_consent'
    end
  from candidates c;

  select count(*), count(*) filter (where eligibility = 'eligible')
    into v_total_count, v_eligible_count
  from public.marketing_campaign_recipients where campaign_id = v_campaign_id;

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, after_state)
  values (p_actor_id, p_actor_role, 'marketing_campaign_snapshot_created', 'marketing_campaign', v_campaign_id,
    jsonb_build_object('audience_type', p_audience_type, 'recipient_count', v_total_count, 'eligible_count', v_eligible_count));

  return jsonb_build_object('campaign_id', v_campaign_id, 'recipient_count', v_total_count, 'eligible_count', v_eligible_count);
end;
$$;

create or replace function public.mkt01_unsubscribe_recipient(p_token uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recipient public.marketing_campaign_recipients;
begin
  select * into v_recipient from public.marketing_campaign_recipients where unsubscribe_token = p_token for update;
  if not found then return; end if;
  if nullif(btrim(coalesce(v_recipient.email_snapshot, '')), '') is null then return; end if;

  insert into public.marketing_suppressions (studio_id, email, salon_customer_id, reason)
  values (v_recipient.studio_id, lower(btrim(v_recipient.email_snapshot)), v_recipient.salon_customer_id, 'unsubscribed')
  on conflict (studio_id, channel, email) do nothing;
  update public.marketing_campaign_recipients set eligibility = 'unsubscribed'
    where id = v_recipient.id and eligibility = 'eligible';
end;
$$;

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_recipients enable row level security;
alter table public.marketing_suppressions enable row level security;
revoke all on public.marketing_campaigns, public.marketing_campaign_recipients, public.marketing_suppressions from public, anon, authenticated;
grant select, insert, update on public.marketing_campaigns, public.marketing_campaign_recipients, public.marketing_suppressions to service_role;
revoke all on function public.mkt01_assert_actor_scope(uuid, uuid, text, uuid), public.mkt01_create_campaign_snapshot(uuid, text, uuid, uuid, text, text, numeric, integer, integer, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mkt01_unsubscribe_recipient(uuid) from public, authenticated;
grant execute on function public.mkt01_assert_actor_scope(uuid, uuid, text, uuid), public.mkt01_create_campaign_snapshot(uuid, text, uuid, uuid, text, text, numeric, integer, integer, text, text, text, text, text) to service_role;
grant execute on function public.mkt01_unsubscribe_recipient(uuid) to anon, service_role;
