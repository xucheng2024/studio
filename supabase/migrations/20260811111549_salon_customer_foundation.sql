-- FND-02: unified Salon Customer identity.
-- Adds salon_customers as the studio-scoped customer profile, independent of
-- member_studio_memberships (which only proves studio membership) so that
-- Walk-in/Guest customers can have a real record. Backfills from existing
-- member_studio_memberships without ever auto-merging on name/email/phone;
-- anything ambiguous is recorded in salon_customer_migration_conflicts for
-- manual Owner/Manager review. Health, consent, appointment and treatment
-- data are explicitly out of scope for this task.

create table if not exists public.salon_customers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  status text not null default 'active'
    check (status = any (array['active'::text, 'inactive'::text, 'blocked'::text])),
  source text not null
    check (source = any (array['online'::text, 'frontdesk'::text, 'walk_in'::text, 'imported'::text])),
  preferred_location_id uuid references public.locations(id) on delete set null,
  merged_into_id uuid references public.salon_customers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_customers_merged_into_not_self check (merged_into_id is null or merged_into_id <> id)
);

create unique index if not exists salon_customers_studio_user_unique
  on public.salon_customers (studio_id, user_id)
  where user_id is not null;

create index if not exists idx_salon_customers_studio_status
  on public.salon_customers (studio_id, status);

create index if not exists idx_salon_customers_studio_email
  on public.salon_customers (studio_id, lower(email))
  where email is not null;

create index if not exists idx_salon_customers_studio_phone
  on public.salon_customers (studio_id, phone)
  where phone is not null;

create index if not exists idx_salon_customers_merged_into
  on public.salon_customers (merged_into_id)
  where merged_into_id is not null;

-- Validates preferred_location_id and merged_into_id (when set) belong to the
-- same studio_id as the row itself — mirrors employees_validate_instructor_studio
-- in 124_employee_foundation.sql.
create or replace function public.salon_customers_validate_studio_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.preferred_location_id is not null then
    if not exists (
      select 1 from public.locations l
      where l.id = new.preferred_location_id and l.studio_id = new.studio_id
    ) then
      raise exception 'salon_customers.preferred_location_id must belong to the same studio_id'
        using errcode = '23514';
    end if;
  end if;

  if new.merged_into_id is not null then
    if not exists (
      select 1 from public.salon_customers c
      where c.id = new.merged_into_id and c.studio_id = new.studio_id
    ) then
      raise exception 'salon_customers.merged_into_id must belong to the same studio_id'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists salon_customers_validate_studio_refs_trg on public.salon_customers;
create trigger salon_customers_validate_studio_refs_trg
  before insert or update of preferred_location_id, merged_into_id, studio_id on public.salon_customers
  for each row execute function public.salon_customers_validate_studio_refs();

-- public.set_updated_at_timestamp() already exists (created in
-- 124_employee_foundation.sql); reuse it rather than redefining.
drop trigger if exists set_salon_customers_updated_at on public.salon_customers;
create trigger set_salon_customers_updated_at
  before update on public.salon_customers
  for each row execute function public.set_updated_at_timestamp();


create table if not exists public.salon_customer_migration_conflicts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_type text not null
    check (source_type = any (array['salon_customer'::text, 'salon_customer_guest_link'::text])),
  source_id uuid not null,
  conflict_code text not null
    check (conflict_code = any (array[
      'duplicate_email_in_studio'::text,
      'duplicate_phone_in_studio'::text,
      'ambiguous_guest_match'::text,
      'guest_link_user_already_has_customer'::text
    ])),
  details jsonb,
  status text not null default 'open'
    check (status = any (array['open'::text, 'resolved'::text, 'ignored'::text])),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists salon_customer_migration_conflicts_open_unique
  on public.salon_customer_migration_conflicts (
    studio_id,
    source_type,
    source_id,
    conflict_code,
    coalesce(details ->> 'matched_customer_id', '')
  )
  where status = 'open';

create index if not exists idx_salon_customer_migration_conflicts_studio_status
  on public.salon_customer_migration_conflicts (studio_id, status);


create table if not exists public.salon_customer_merge_audits (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_customer_id uuid not null references public.salon_customers(id),
  target_customer_id uuid not null references public.salon_customers(id),
  merged_by uuid references public.users(id) on delete set null,
  reason text,
  source_snapshot jsonb not null,
  target_snapshot jsonb not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint salon_customer_merge_audits_distinct_customers check (source_customer_id <> target_customer_id)
);

create index if not exists idx_salon_customer_merge_audits_studio
  on public.salon_customer_merge_audits (studio_id);


-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.salon_customers enable row level security;
alter table public.salon_customer_migration_conflicts enable row level security;
alter table public.salon_customer_merge_audits enable row level security;

revoke all on table public.salon_customers from public;
revoke all on table public.salon_customers from anon;
revoke all on table public.salon_customers from authenticated;
grant all on table public.salon_customers to service_role;

revoke all on table public.salon_customer_migration_conflicts from public;
revoke all on table public.salon_customer_migration_conflicts from anon;
revoke all on table public.salon_customer_migration_conflicts from authenticated;
grant all on table public.salon_customer_migration_conflicts to service_role;

revoke all on table public.salon_customer_merge_audits from public;
revoke all on table public.salon_customer_merge_audits from anon;
revoke all on table public.salon_customer_merge_audits from authenticated;
grant all on table public.salon_customer_merge_audits to service_role;

drop policy if exists salon_customers_self_read on public.salon_customers;
create policy salon_customers_self_read
on public.salon_customers
for select
using (auth.uid() = user_id);

-- `revoke all` above also strips the table-level SELECT privilege that RLS
-- filtering depends on; without this grant the self-read policy above is
-- silently unreachable (see 116_fix_self_read_grants_and_harden_public_content_tables.sql
-- for the same mistake made and fixed elsewhere in this repo).
grant select on table public.salon_customers to authenticated;

-- salon_customer_migration_conflicts and salon_customer_merge_audits intentionally
-- have no client-facing policy: they hold diagnostic details and merge snapshots
-- for staff review only (service_role only, same posture as guest_merge_audits /
-- employee_migration_conflicts).


-- ── Backfill (idempotent, safe to retry; never mutates member_studio_memberships) ──
create or replace function public.backfill_salon_customers_from_memberships()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_studio record;
  v_membership record;
  v_full_name text;
  v_email text;
  v_phone text;
  v_status text;
  v_customer_id uuid;
  v_created_customers integer := 0;
  v_skipped_existing integer := 0;
  v_duplicate_conflicts integer := 0;
  v_rows integer;
  v_dup record;
begin
  for v_studio in select id from public.studios loop

    for v_membership in
      select m.user_id, m.status
      from public.member_studio_memberships m
      where m.studio_id = v_studio.id
    loop
      if exists (
        select 1 from public.salon_customers c
        where c.studio_id = v_studio.id and c.user_id = v_membership.user_id
      ) then
        v_skipped_existing := v_skipped_existing + 1;
        continue;
      end if;

      select
        coalesce(nullif(trim(up.full_name), ''), nullif(trim(up.email), ''), nullif(trim(u.email), ''), 'Unnamed customer'),
        nullif(lower(trim(coalesce(up.email, u.email))), ''),
        nullif(trim(up.phone), '')
      into v_full_name, v_email, v_phone
      from public.users u
      left join public.user_profiles up on up.id = u.id
      where u.id = v_membership.user_id;

      v_status := case when v_membership.status = 'active' then 'active' else 'inactive' end;

      insert into public.salon_customers
        (studio_id, user_id, full_name, email, phone, status, source)
      values
        (v_studio.id, v_membership.user_id, coalesce(v_full_name, 'Unnamed customer'), v_email, v_phone, v_status, 'imported')
      returning id into v_customer_id;
      v_created_customers := v_created_customers + 1;

      if v_email is not null then
        for v_dup in
          select id from public.salon_customers
          where studio_id = v_studio.id
            and id <> v_customer_id
            and lower(email) = v_email
        loop
          insert into public.salon_customer_migration_conflicts
            (studio_id, source_type, source_id, conflict_code, details)
          values
            (v_studio.id, 'salon_customer', v_customer_id, 'duplicate_email_in_studio',
             jsonb_build_object('email', v_email, 'matched_customer_id', v_dup.id))
          on conflict do nothing;
          get diagnostics v_rows = row_count;
          v_duplicate_conflicts := v_duplicate_conflicts + v_rows;
        end loop;
      end if;

      if v_phone is not null then
        for v_dup in
          select id from public.salon_customers
          where studio_id = v_studio.id
            and id <> v_customer_id
            and phone = v_phone
        loop
          insert into public.salon_customer_migration_conflicts
            (studio_id, source_type, source_id, conflict_code, details)
          values
            (v_studio.id, 'salon_customer', v_customer_id, 'duplicate_phone_in_studio',
             jsonb_build_object('phone', v_phone, 'matched_customer_id', v_dup.id))
          on conflict do nothing;
          get diagnostics v_rows = row_count;
          v_duplicate_conflicts := v_duplicate_conflicts + v_rows;
        end loop;
      end if;

    end loop;

  end loop;

  return jsonb_build_object(
    'ok', true,
    'customers_created', v_created_customers,
    'customers_skipped_existing', v_skipped_existing,
    'duplicate_conflicts_created', v_duplicate_conflicts
  );
end;
$$;

select public.backfill_salon_customers_from_memberships();


-- ── Human-confirmed merge RPC ──────────────────────────────────────────
-- salon_customers are never auto-merged. This RPC is only ever called from
-- server-side code after an Owner/Manager has confirmed the merge
-- (see src/lib/salon-customers.ts). The source row is kept (never deleted),
-- flagged via merged_into_id, and a full snapshot is written to
-- salon_customer_merge_audits — Appointment/Treatment/Payment don't reference
-- salon_customer_id yet, so there is nothing else to repoint today; future
-- tables can resolve through merged_into_id at read time.
create or replace function public.merge_salon_customers(
  p_studio_id uuid,
  p_source_customer_id uuid,
  p_target_customer_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_source public.salon_customers%rowtype;
  v_target public.salon_customers%rowtype;
  v_source_after public.salon_customers%rowtype;
  v_target_after public.salon_customers%rowtype;
begin
  if p_source_customer_id = p_target_customer_id then
    raise exception 'source and target customer must differ' using errcode = '23514';
  end if;

  select * into v_source from public.salon_customers
  where id = p_source_customer_id and studio_id = p_studio_id
  for update;
  if not found then
    raise exception 'source customer % not found in studio %', p_source_customer_id, p_studio_id
      using errcode = 'P0002';
  end if;

  select * into v_target from public.salon_customers
  where id = p_target_customer_id and studio_id = p_studio_id
  for update;
  if not found then
    raise exception 'target customer % not found in studio %', p_target_customer_id, p_studio_id
      using errcode = 'P0002';
  end if;

  if v_source.merged_into_id is not null then
    raise exception 'source customer % is already merged', p_source_customer_id using errcode = '23514';
  end if;
  if v_target.merged_into_id is not null then
    raise exception 'target customer % is already merged', p_target_customer_id using errcode = '23514';
  end if;

  if v_source.user_id is not null
     and v_target.user_id is not null
     and v_source.user_id <> v_target.user_id then
    raise exception 'cannot merge customers associated with different users'
      using errcode = '23514';
  end if;

  if v_source.user_id is not null and v_target.user_id is null then
    -- Transfer the authenticated identity to the surviving record. Clear it
    -- from the source first so the partial (studio_id, user_id) uniqueness
    -- constraint remains satisfied throughout the transaction.
    update public.salon_customers
    set merged_into_id = p_target_customer_id, user_id = null
    where id = p_source_customer_id;

    update public.salon_customers
    set user_id = v_source.user_id
    where id = p_target_customer_id;
  else
    update public.salon_customers
    set merged_into_id = p_target_customer_id
    where id = p_source_customer_id;
  end if;

  update public.salon_customer_migration_conflicts
  set status = 'resolved', resolved_at = now(), resolved_by = p_actor_id
  where studio_id = p_studio_id
    and status = 'open'
    and source_type = 'salon_customer'
    and (
      source_id = p_source_customer_id
      or details ->> 'matched_customer_id' = p_source_customer_id::text
    );

  select * into strict v_source_after
  from public.salon_customers
  where id = p_source_customer_id;

  select * into strict v_target_after
  from public.salon_customers
  where id = p_target_customer_id;

  insert into public.salon_customer_merge_audits
    (studio_id, source_customer_id, target_customer_id, merged_by, reason,
     source_snapshot, target_snapshot, result_snapshot)
  values
    (p_studio_id, p_source_customer_id, p_target_customer_id, p_actor_id, p_reason,
     to_jsonb(v_source), to_jsonb(v_target),
     jsonb_build_object('source', to_jsonb(v_source_after), 'target', to_jsonb(v_target_after)));

  return jsonb_build_object('ok', true, 'source_customer_id', p_source_customer_id, 'target_customer_id', p_target_customer_id);
end;
$$;


-- ── Guest Merge extension ───────────────────────────────────────────────
-- Called from merge_guest_records_for_user (051_member_profile_notes.sql) on
-- new user creation / email update. Only auto-links when a studio has exactly
-- one unlinked (user_id is null, not merged) guest salon_customer matching
-- the user's email; otherwise records a conflict for manual review. Never
-- guesses across multiple candidates, never crosses studio boundaries.
create or replace function public.link_guest_salon_customers_for_user(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_match record;
  v_customers_linked integer := 0;
  v_conflicts_created integer := 0;
  v_rows integer;
begin
  if p_user_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  for v_match in
    select studio_id, array_agg(id) as candidate_ids
    from public.salon_customers
    where lower(email) = v_email
      and user_id is null
      and merged_into_id is null
    group by studio_id
  loop
    if array_length(v_match.candidate_ids, 1) > 1 then
      insert into public.salon_customer_migration_conflicts
        (studio_id, source_type, source_id, conflict_code, details)
      values
        (v_match.studio_id, 'salon_customer_guest_link', p_user_id, 'ambiguous_guest_match',
         jsonb_build_object('email', v_email, 'candidate_customer_ids', to_jsonb(v_match.candidate_ids)))
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_conflicts_created := v_conflicts_created + v_rows;
      continue;
    end if;

    if exists (
      select 1 from public.salon_customers
      where studio_id = v_match.studio_id and user_id = p_user_id
    ) then
      insert into public.salon_customer_migration_conflicts
        (studio_id, source_type, source_id, conflict_code, details)
      values
        (v_match.studio_id, 'salon_customer_guest_link', p_user_id, 'guest_link_user_already_has_customer',
         jsonb_build_object('email', v_email, 'candidate_customer_id', v_match.candidate_ids[1]))
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_conflicts_created := v_conflicts_created + v_rows;
      continue;
    end if;

    update public.salon_customers
    set user_id = p_user_id
    where id = v_match.candidate_ids[1];

    insert into public.operation_audits
      (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values
      (p_user_id, 'client', 'salon_customer_guest_auto_link', 'salon_customer', v_match.candidate_ids[1],
       jsonb_build_object('user_id', null), jsonb_build_object('user_id', p_user_id));
    v_customers_linked := v_customers_linked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'salon_customers_linked', v_customers_linked,
    'salon_customer_conflicts_created', v_conflicts_created
  );
end;
$$;

create or replace function public.merge_guest_records_for_user(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_bookings_count int := 0;
  v_payments_count int := 0;
  v_guest_link_result jsonb;
begin
  if p_user_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  update public.bookings b
  set client_id = p_user_id
  where b.client_id is null
    and b.guest_email is not null
    and lower(trim(b.guest_email)) = v_email;
  get diagnostics v_bookings_count = row_count;

  update public.payments p
  set client_id = p_user_id
  where p.client_id is null
    and (
      (p.booking_id is not null and exists (
        select 1
        from public.bookings b
        where b.id = p.booking_id and lower(trim(coalesce(b.guest_email, ''))) = v_email
      ))
      or lower(trim(coalesce(p.guest_email, ''))) = v_email
    );
  get diagnostics v_payments_count = row_count;

  insert into public.guest_merge_audits (user_id, email, merged_bookings, merged_payments)
  values (p_user_id, v_email, v_bookings_count, v_payments_count);

  v_guest_link_result := public.link_guest_salon_customers_for_user(p_user_id, v_email);

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'merged_bookings', v_bookings_count,
    'merged_payments', v_payments_count,
    'salon_customers_linked', coalesce(v_guest_link_result -> 'salon_customers_linked', '0'::jsonb),
    'salon_customer_conflicts_created', coalesce(v_guest_link_result -> 'salon_customer_conflicts_created', '0'::jsonb)
  );
end;
$$;


-- ── Function grants ────────────────────────────────────────────────────
revoke all on function public.salon_customers_validate_studio_refs() from public;
revoke all on function public.salon_customers_validate_studio_refs() from anon;
revoke all on function public.salon_customers_validate_studio_refs() from authenticated;
grant all on function public.salon_customers_validate_studio_refs() to service_role;

revoke all on function public.backfill_salon_customers_from_memberships() from public;
revoke all on function public.backfill_salon_customers_from_memberships() from anon;
revoke all on function public.backfill_salon_customers_from_memberships() from authenticated;
grant all on function public.backfill_salon_customers_from_memberships() to service_role;

revoke all on function public.merge_salon_customers(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.merge_salon_customers(uuid, uuid, uuid, uuid, text) from anon;
revoke all on function public.merge_salon_customers(uuid, uuid, uuid, uuid, text) from authenticated;
grant all on function public.merge_salon_customers(uuid, uuid, uuid, uuid, text) to service_role;

revoke all on function public.link_guest_salon_customers_for_user(uuid, text) from public;
revoke all on function public.link_guest_salon_customers_for_user(uuid, text) from anon;
revoke all on function public.link_guest_salon_customers_for_user(uuid, text) from authenticated;
grant all on function public.link_guest_salon_customers_for_user(uuid, text) to service_role;

-- merge_guest_records_for_user keeps its existing grants (hardened to
-- service_role only by 112_harden_legacy_rpc_grants.sql); replacing the
-- function body here does not change its grants.
