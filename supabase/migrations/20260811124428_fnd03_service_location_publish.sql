-- FND-03: Service and location publishing.
-- Keeps studio_services as the studio-wide service catalog and adds
-- service_locations to express, per Location, whether a service is
-- published/enabled and whether it uses the HQ default price/duration/buffer
-- or a location-specific override. Studio/location/service consistency is
-- enforced in the database (trigger + RPC-internal checks), not just in the
-- app layer. Changes are audited via the existing operation_audits table
-- (before/after, actor, timestamp) rather than a new bespoke audit table.

-- ── studio_services: publish-scope setting ─────────────────────────────
-- Recorded on the service itself (not derivable from service_locations rows
-- alone) so that newly created locations know whether they should
-- automatically receive this service — see provision_service_locations_for_location().
alter table public.studio_services
  add column if not exists location_publish_scope text not null default 'all_locations'
    check (location_publish_scope = any (array['all_locations'::text, 'selected_locations'::text]));


-- ── service_locations ───────────────────────────────────────────────────
create table if not exists public.service_locations (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.studio_services(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  is_enabled boolean not null default true,
  uses_default_values boolean not null default true,
  price_override numeric(12, 2) check (price_override is null or price_override >= 0),
  duration_override_minutes integer check (duration_override_minutes is null or duration_override_minutes > 0),
  buffer_override_minutes integer check (buffer_override_minutes is null or buffer_override_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_locations_default_requires_null_overrides check (
    uses_default_values = false
    or (price_override is null and duration_override_minutes is null and buffer_override_minutes is null)
  )
);

create unique index if not exists service_locations_service_location_unique
  on public.service_locations (service_id, location_id);

create index if not exists idx_service_locations_studio
  on public.service_locations (studio_id);

create index if not exists idx_service_locations_location_enabled
  on public.service_locations (location_id, is_enabled);

-- Re-validates service_id/location_id belong to studio_id, mirroring
-- employee_locations_validate_studio (124_employee_foundation.sql) and
-- salon_customers_validate_studio_refs (salon_customer_foundation migration).
-- This is the database-level guarantee that a studio/location mismatch can
-- never be written, independent of any RPC-internal check.
create or replace function public.service_locations_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_location_studio uuid;
begin
  select studio_id into v_service_studio from public.studio_services where id = new.service_id;
  select studio_id into v_location_studio from public.locations where id = new.location_id;

  if v_service_studio is null or v_location_studio is null then
    raise exception 'service_locations references a missing service or location'
      using errcode = '23503';
  end if;

  if v_service_studio <> new.studio_id or v_location_studio <> new.studio_id then
    raise exception 'service_locations.studio_id must match both service and location studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists service_locations_validate_studio_trg on public.service_locations;
create trigger service_locations_validate_studio_trg
  before insert or update of service_id, location_id, studio_id on public.service_locations
  for each row execute function public.service_locations_validate_studio();

-- public.set_updated_at_timestamp() already exists (124_employee_foundation.sql).
drop trigger if exists set_service_locations_updated_at on public.service_locations;
create trigger set_service_locations_updated_at
  before update on public.service_locations
  for each row execute function public.set_updated_at_timestamp();


-- ── Auto-provision new locations into "all locations" services ─────────
-- Doc 02-multi-location.md 2.4: "All locations" publishing must also cover
-- locations created after the service. Implemented as a trigger so it works
-- regardless of which code path creates a location (no app-code change
-- required), and is idempotent via ON CONFLICT DO NOTHING.
create or replace function public.provision_service_locations_for_location()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
  select ss.id, new.id, new.studio_id, true, true
  from public.studio_services ss
  where ss.studio_id = new.studio_id
    and ss.location_publish_scope = 'all_locations'
  on conflict (service_id, location_id) do nothing;
  return new;
end;
$$;

drop trigger if exists provision_service_locations_for_location_trg on public.locations;
create trigger provision_service_locations_for_location_trg
  after insert on public.locations
  for each row execute function public.provision_service_locations_for_location();


-- Symmetric counterpart: a brand-new studio_services row defaults to
-- location_publish_scope = 'all_locations' (the column default), and without
-- this trigger it would have zero service_locations rows until someone
-- explicitly calls set_service_publish_scope — silently invisible at every
-- location. That would be a regression from the pre-FND-03 behaviour (no
-- location filtering at all, so every service was implicitly available
-- everywhere), including for services created via the existing, unmodified
-- createStudioService Server Action, which this task does not touch.
create or replace function public.provision_service_locations_for_new_service()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.location_publish_scope = 'all_locations' then
    insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
    select new.id, l.id, new.studio_id, true, true
    from public.locations l
    where l.studio_id = new.studio_id
    on conflict (service_id, location_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists provision_service_locations_for_new_service_trg on public.studio_services;
create trigger provision_service_locations_for_new_service_trg
  after insert on public.studio_services
  for each row execute function public.provision_service_locations_for_new_service();


-- ── RLS ─────────────────────────────────────────────────────────────────
-- No client-facing policy: service_locations has no "own row" concept (unlike
-- employees/salon_customers' self-read policies). All reads/writes go through
-- server-side lib functions (src/lib/service-locations.ts) using the admin
-- client, with scope checks in TypeScript — same posture as
-- employee_migration_conflicts / salon_customer_migration_conflicts.
alter table public.service_locations enable row level security;

revoke all on table public.service_locations from public;
revoke all on table public.service_locations from anon;
revoke all on table public.service_locations from authenticated;
grant all on table public.service_locations to service_role;


-- ── RPC: set_service_publish_scope ─────────────────────────────────────
-- Owner / global (all-location) Manager only, enforced in
-- src/lib/service-locations.ts via requireGlobalStaffScope before calling
-- this RPC. 'all_locations' provisions any missing rows across every
-- location in the studio; 'selected_locations' provisions/enables the given
-- locations and disables (never deletes) existing enabled rows outside the
-- list, preserving the "location can turn a service off without deleting the
-- HQ service" requirement.
create or replace function public.set_service_publish_scope(
  p_actor_id uuid,
  p_studio_id uuid,
  p_service_id uuid,
  p_scope text,
  p_location_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service public.studio_services%rowtype;
  v_before_scope text;
  v_location_id uuid;
  v_before_row public.service_locations%rowtype;
  v_after_row public.service_locations%rowtype;
  v_rows_touched integer := 0;
begin
  if p_scope not in ('all_locations', 'selected_locations') then
    raise exception 'invalid publish scope %', p_scope using errcode = '22023';
  end if;

  select * into v_service from public.studio_services
    where id = p_service_id and studio_id = p_studio_id
    for update;
  if not found then
    raise exception 'service % not found in studio %', p_service_id, p_studio_id using errcode = 'P0002';
  end if;

  if p_scope = 'selected_locations' then
    if p_location_ids is null or array_length(p_location_ids, 1) is null then
      raise exception 'selected_locations scope requires at least one location' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_location_ids) as loc_id
      where not exists (select 1 from public.locations l where l.id = loc_id and l.studio_id = p_studio_id)
    ) then
      raise exception 'one or more location_ids do not belong to studio %', p_studio_id using errcode = '23514';
    end if;
  end if;

  v_before_scope := v_service.location_publish_scope;
  if v_before_scope is distinct from p_scope then
    update public.studio_services set location_publish_scope = p_scope where id = p_service_id;

    insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values (
      p_actor_id, 'staff', 'service_publish_scope_changed', 'studio_service', p_service_id,
      jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_publish_scope', v_before_scope),
      jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_publish_scope', p_scope)
    );
  end if;

  if p_scope = 'all_locations' then
    for v_location_id in select id from public.locations where studio_id = p_studio_id loop
      select * into v_before_row from public.service_locations
        where service_id = p_service_id and location_id = v_location_id;

      if not found then
        insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
        values (p_service_id, v_location_id, p_studio_id, true, true)
        returning * into v_after_row;

        insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
        values (
          p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
          jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_id', v_location_id, 'existed', false),
          to_jsonb(v_after_row)
        );
        v_rows_touched := v_rows_touched + 1;
      elsif v_before_row.is_enabled is distinct from true then
        update public.service_locations set is_enabled = true
          where id = v_before_row.id
          returning * into v_after_row;

        insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
        values (
          p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
          to_jsonb(v_before_row), to_jsonb(v_after_row)
        );
        v_rows_touched := v_rows_touched + 1;
      end if;
    end loop;
  else
    foreach v_location_id in array p_location_ids loop
      select * into v_before_row from public.service_locations
        where service_id = p_service_id and location_id = v_location_id;

      if not found then
        insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
        values (p_service_id, v_location_id, p_studio_id, true, true)
        returning * into v_after_row;

        insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
        values (
          p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
          jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_id', v_location_id, 'existed', false),
          to_jsonb(v_after_row)
        );
        v_rows_touched := v_rows_touched + 1;
      elsif v_before_row.is_enabled is distinct from true then
        update public.service_locations set is_enabled = true
          where id = v_before_row.id
          returning * into v_after_row;

        insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
        values (
          p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
          to_jsonb(v_before_row), to_jsonb(v_after_row)
        );
        v_rows_touched := v_rows_touched + 1;
      end if;
    end loop;

    for v_before_row in
      select * from public.service_locations
      where service_id = p_service_id
        and studio_id = p_studio_id
        and is_enabled = true
        and not (location_id = any (p_location_ids))
    loop
      update public.service_locations set is_enabled = false
        where id = v_before_row.id
        returning * into v_after_row;

      insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
      values (
        p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
        to_jsonb(v_before_row), to_jsonb(v_after_row)
      );
      v_rows_touched := v_rows_touched + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'scope', p_scope, 'locations_touched', v_rows_touched);
end;
$$;


-- ── RPC: set_service_location_enabled ──────────────────────────────────
-- Owner / global Manager (any location) or Location Manager restricted to
-- their own authorised location — enforced in
-- src/lib/service-locations.ts via requireStaffScope before calling this
-- RPC. Never deletes the row: disabling a service at a location must not
-- remove the HQ service or the location's history.
create or replace function public.set_service_location_enabled(
  p_actor_id uuid,
  p_studio_id uuid,
  p_service_id uuid,
  p_location_id uuid,
  p_is_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_location_studio uuid;
  v_before_row public.service_locations%rowtype;
  v_after_row public.service_locations%rowtype;
begin
  select studio_id into v_service_studio from public.studio_services where id = p_service_id;
  select studio_id into v_location_studio from public.locations where id = p_location_id;

  if v_service_studio is null or v_location_studio is null then
    raise exception 'service or location not found' using errcode = 'P0002';
  end if;
  if v_service_studio <> p_studio_id or v_location_studio <> p_studio_id then
    raise exception 'service and location must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  select * into v_before_row from public.service_locations
    where service_id = p_service_id and location_id = p_location_id
    for update;

  if not found then
    insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
    values (p_service_id, p_location_id, p_studio_id, p_is_enabled, true)
    returning * into v_after_row;

    insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values (
      p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
      jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_id', p_location_id, 'existed', false),
      to_jsonb(v_after_row)
    );
  else
    if v_before_row.is_enabled = p_is_enabled then
      return jsonb_build_object('ok', true, 'unchanged', true, 'service_location_id', v_before_row.id);
    end if;

    update public.service_locations set is_enabled = p_is_enabled
      where id = v_before_row.id
      returning * into v_after_row;

    insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values (
      p_actor_id, 'staff', 'service_location_enabled_changed', 'service_location', v_after_row.id,
      to_jsonb(v_before_row), to_jsonb(v_after_row)
    );
  end if;

  return jsonb_build_object('ok', true, 'service_location_id', v_after_row.id, 'is_enabled', v_after_row.is_enabled);
end;
$$;


-- ── RPC: set_service_location_override ─────────────────────────────────
-- Same scope rule as set_service_location_enabled (Owner/global Manager any
-- location, Location Manager own location only). Forces override columns to
-- null whenever uses_default_values is true, regardless of what the caller
-- passed — defensive, mirrors the table check constraint.
create or replace function public.set_service_location_override(
  p_actor_id uuid,
  p_studio_id uuid,
  p_service_id uuid,
  p_location_id uuid,
  p_uses_default_values boolean,
  p_price_override numeric default null,
  p_duration_override_minutes integer default null,
  p_buffer_override_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_location_studio uuid;
  v_before_row public.service_locations%rowtype;
  v_after_row public.service_locations%rowtype;
  v_price numeric;
  v_duration integer;
  v_buffer integer;
begin
  select studio_id into v_service_studio from public.studio_services where id = p_service_id;
  select studio_id into v_location_studio from public.locations where id = p_location_id;

  if v_service_studio is null or v_location_studio is null then
    raise exception 'service or location not found' using errcode = 'P0002';
  end if;
  if v_service_studio <> p_studio_id or v_location_studio <> p_studio_id then
    raise exception 'service and location must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  if p_uses_default_values then
    v_price := null;
    v_duration := null;
    v_buffer := null;
  else
    if p_price_override is not null and p_price_override < 0 then
      raise exception 'price override must not be negative' using errcode = '23514';
    end if;
    if p_duration_override_minutes is not null and p_duration_override_minutes <= 0 then
      raise exception 'duration override must be positive' using errcode = '23514';
    end if;
    if p_buffer_override_minutes is not null and p_buffer_override_minutes < 0 then
      raise exception 'buffer override must not be negative' using errcode = '23514';
    end if;
    v_price := p_price_override;
    v_duration := p_duration_override_minutes;
    v_buffer := p_buffer_override_minutes;
  end if;

  select * into v_before_row from public.service_locations
    where service_id = p_service_id and location_id = p_location_id
    for update;

  if not found then
    insert into public.service_locations
      (service_id, location_id, studio_id, is_enabled, uses_default_values, price_override, duration_override_minutes, buffer_override_minutes)
    values
      (p_service_id, p_location_id, p_studio_id, true, p_uses_default_values, v_price, v_duration, v_buffer)
    returning * into v_after_row;

    insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values (
      p_actor_id, 'staff', 'service_location_override_changed', 'service_location', v_after_row.id,
      jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'location_id', p_location_id, 'existed', false),
      to_jsonb(v_after_row)
    );
  else
    update public.service_locations
    set uses_default_values = p_uses_default_values,
        price_override = v_price,
        duration_override_minutes = v_duration,
        buffer_override_minutes = v_buffer
    where id = v_before_row.id
    returning * into v_after_row;

    insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
    values (
      p_actor_id, 'staff', 'service_location_override_changed', 'service_location', v_after_row.id,
      to_jsonb(v_before_row), to_jsonb(v_after_row)
    );
  end if;

  return jsonb_build_object('ok', true, 'service_location_id', v_after_row.id);
end;
$$;


-- ── RPC: update_studio_service_default_price ───────────────────────────
-- Owner / global Manager only. studio_services.price is currently the only
-- HQ default value that exists (duration/buffer HQ defaults are out of
-- scope for FND-03 — see 01-appointment.md: "studio_services 当前缺少标准
-- 服务时长、服务缓冲时间"). Propagation modes:
--   hq_only            -> only studio_services.price changes.
--   all_locations       -> also resets every service_locations row for this
--                          service to uses_default_values = true (overrides
--                          cleared), so every location follows the new price.
--   selected_locations  -> same reset, restricted to p_location_ids.
-- Locations left out of a reset keep whatever custom override they had.
create or replace function public.update_studio_service_default_price(
  p_actor_id uuid,
  p_studio_id uuid,
  p_service_id uuid,
  p_price numeric,
  p_propagation_mode text,
  p_location_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service public.studio_services%rowtype;
  v_before_price numeric;
  v_before_row public.service_locations%rowtype;
  v_after_row public.service_locations%rowtype;
  v_location_id uuid;
  v_rows_reset integer := 0;
begin
  if p_propagation_mode not in ('hq_only', 'all_locations', 'selected_locations') then
    raise exception 'invalid propagation mode %', p_propagation_mode using errcode = '22023';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'price must not be negative' using errcode = '23514';
  end if;

  select * into v_service from public.studio_services
    where id = p_service_id and studio_id = p_studio_id
    for update;
  if not found then
    raise exception 'service % not found in studio %', p_service_id, p_studio_id using errcode = 'P0002';
  end if;

  if p_propagation_mode = 'selected_locations' then
    if p_location_ids is null or array_length(p_location_ids, 1) is null then
      raise exception 'selected_locations propagation requires at least one location' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_location_ids) as loc_id
      where not exists (select 1 from public.locations l where l.id = loc_id and l.studio_id = p_studio_id)
    ) then
      raise exception 'one or more location_ids do not belong to studio %', p_studio_id using errcode = '23514';
    end if;
  end if;

  v_before_price := v_service.price;

  update public.studio_services set price = p_price where id = p_service_id;

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_actor_id, 'staff', 'service_hq_price_propagated', 'studio_service', p_service_id,
    jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'price', v_before_price, 'propagation_mode', p_propagation_mode),
    jsonb_build_object('studio_id', p_studio_id, 'service_id', p_service_id, 'price', p_price, 'propagation_mode', p_propagation_mode)
  );

  if p_propagation_mode = 'all_locations' then
    for v_before_row in
      select * from public.service_locations
      where service_id = p_service_id and studio_id = p_studio_id
        and (
          uses_default_values = false
          or price_override is not null
          or duration_override_minutes is not null
          or buffer_override_minutes is not null
        )
    loop
      update public.service_locations
      set uses_default_values = true, price_override = null, duration_override_minutes = null, buffer_override_minutes = null
      where id = v_before_row.id
      returning * into v_after_row;

      insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
      values (
        p_actor_id, 'staff', 'service_location_override_changed', 'service_location', v_after_row.id,
        to_jsonb(v_before_row), to_jsonb(v_after_row)
      );
      v_rows_reset := v_rows_reset + 1;
    end loop;
  elsif p_propagation_mode = 'selected_locations' then
    foreach v_location_id in array p_location_ids loop
      select * into v_before_row from public.service_locations
        where service_id = p_service_id and location_id = v_location_id and studio_id = p_studio_id;

      if found and (
        v_before_row.uses_default_values = false
        or v_before_row.price_override is not null
        or v_before_row.duration_override_minutes is not null
        or v_before_row.buffer_override_minutes is not null
      ) then
        update public.service_locations
        set uses_default_values = true, price_override = null, duration_override_minutes = null, buffer_override_minutes = null
        where id = v_before_row.id
        returning * into v_after_row;

        insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
        values (
          p_actor_id, 'staff', 'service_location_override_changed', 'service_location', v_after_row.id,
          to_jsonb(v_before_row), to_jsonb(v_after_row)
        );
        v_rows_reset := v_rows_reset + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'price', p_price, 'propagation_mode', p_propagation_mode, 'locations_reset', v_rows_reset);
end;
$$;


-- ── Backfill (idempotent, safe to retry) ────────────────────────────────
-- Every existing studio_service is treated as already published to every
-- existing location in its studio (is_enabled = true, uses_default_values =
-- true, no override values invented) — this preserves current behaviour,
-- where services are shown/bookable regardless of location. Never touches
-- studio_services or locations.
create or replace function public.backfill_service_locations_from_existing_studio_services()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_created integer := 0;
begin
  insert into public.service_locations (service_id, location_id, studio_id, is_enabled, uses_default_values)
  select ss.id, l.id, ss.studio_id, true, true
  from public.studio_services ss
  join public.locations l on l.studio_id = ss.studio_id
  on conflict (service_id, location_id) do nothing;
  get diagnostics v_created = row_count;

  return jsonb_build_object('ok', true, 'service_location_rows_created', v_created);
end;
$$;

select public.backfill_service_locations_from_existing_studio_services();


-- ── Function grants ────────────────────────────────────────────────────
revoke all on function public.service_locations_validate_studio() from public;
revoke all on function public.service_locations_validate_studio() from anon;
revoke all on function public.service_locations_validate_studio() from authenticated;
grant all on function public.service_locations_validate_studio() to service_role;

revoke all on function public.provision_service_locations_for_location() from public;
revoke all on function public.provision_service_locations_for_location() from anon;
revoke all on function public.provision_service_locations_for_location() from authenticated;
grant all on function public.provision_service_locations_for_location() to service_role;

revoke all on function public.provision_service_locations_for_new_service() from public;
revoke all on function public.provision_service_locations_for_new_service() from anon;
revoke all on function public.provision_service_locations_for_new_service() from authenticated;
grant all on function public.provision_service_locations_for_new_service() to service_role;

revoke all on function public.set_service_publish_scope(uuid, uuid, uuid, text, uuid[]) from public;
revoke all on function public.set_service_publish_scope(uuid, uuid, uuid, text, uuid[]) from anon;
revoke all on function public.set_service_publish_scope(uuid, uuid, uuid, text, uuid[]) from authenticated;
grant all on function public.set_service_publish_scope(uuid, uuid, uuid, text, uuid[]) to service_role;

revoke all on function public.set_service_location_enabled(uuid, uuid, uuid, uuid, boolean) from public;
revoke all on function public.set_service_location_enabled(uuid, uuid, uuid, uuid, boolean) from anon;
revoke all on function public.set_service_location_enabled(uuid, uuid, uuid, uuid, boolean) from authenticated;
grant all on function public.set_service_location_enabled(uuid, uuid, uuid, uuid, boolean) to service_role;

revoke all on function public.set_service_location_override(uuid, uuid, uuid, uuid, boolean, numeric, integer, integer) from public;
revoke all on function public.set_service_location_override(uuid, uuid, uuid, uuid, boolean, numeric, integer, integer) from anon;
revoke all on function public.set_service_location_override(uuid, uuid, uuid, uuid, boolean, numeric, integer, integer) from authenticated;
grant all on function public.set_service_location_override(uuid, uuid, uuid, uuid, boolean, numeric, integer, integer) to service_role;

revoke all on function public.update_studio_service_default_price(uuid, uuid, uuid, numeric, text, uuid[]) from public;
revoke all on function public.update_studio_service_default_price(uuid, uuid, uuid, numeric, text, uuid[]) from anon;
revoke all on function public.update_studio_service_default_price(uuid, uuid, uuid, numeric, text, uuid[]) from authenticated;
grant all on function public.update_studio_service_default_price(uuid, uuid, uuid, numeric, text, uuid[]) to service_role;

revoke all on function public.backfill_service_locations_from_existing_studio_services() from public;
revoke all on function public.backfill_service_locations_from_existing_studio_services() from anon;
revoke all on function public.backfill_service_locations_from_existing_studio_services() from authenticated;
grant all on function public.backfill_service_locations_from_existing_studio_services() to service_role;
