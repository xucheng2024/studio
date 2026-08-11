-- APT-01 follow-up hardening:
-- Add atomic batch RPCs so week/resource form submissions do not partially
-- commit when one item fails validation midway.

create or replace function public.set_location_operating_hours_for_week(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_days jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day jsonb;
  v_weekday integer;
  v_is_closed boolean;
  v_intervals jsonb;
begin
  if p_days is null or jsonb_typeof(p_days) <> 'array' then
    raise exception 'p_days must be a json array' using errcode = '22023';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    if jsonb_typeof(v_day) <> 'object' then
      raise exception 'each day item must be an object' using errcode = '22023';
    end if;

    v_weekday := (v_day->>'weekday')::integer;
    v_is_closed := coalesce((v_day->>'is_closed')::boolean, false);
    v_intervals := coalesce(v_day->'intervals', '[]'::jsonb);

    perform public.set_location_operating_hours_for_weekday(
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_studio_id := p_studio_id,
      p_location_id := p_location_id,
      p_weekday := v_weekday,
      p_is_closed := v_is_closed,
      p_intervals := v_intervals
    );
  end loop;

  return jsonb_build_object('ok', true, 'updated_days', jsonb_array_length(p_days));
end;
$$;

create or replace function public.set_employee_working_hours_for_week(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_employee_id uuid,
  p_location_id uuid,
  p_days jsonb,
  p_effective_from date default null,
  p_effective_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day jsonb;
  v_weekday integer;
  v_intervals jsonb;
begin
  if p_days is null or jsonb_typeof(p_days) <> 'array' then
    raise exception 'p_days must be a json array' using errcode = '22023';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    if jsonb_typeof(v_day) <> 'object' then
      raise exception 'each day item must be an object' using errcode = '22023';
    end if;

    v_weekday := (v_day->>'weekday')::integer;
    v_intervals := coalesce(v_day->'intervals', '[]'::jsonb);

    perform public.set_employee_working_hours_for_weekday(
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_studio_id := p_studio_id,
      p_employee_id := p_employee_id,
      p_location_id := p_location_id,
      p_weekday := v_weekday,
      p_intervals := v_intervals,
      p_effective_from := p_effective_from,
      p_effective_until := p_effective_until
    );
  end loop;

  return jsonb_build_object('ok', true, 'updated_days', jsonb_array_length(p_days));
end;
$$;

create or replace function public.set_service_resource_requirements(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_service_id uuid,
  p_requirements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item jsonb;
  v_resource_type text;
  v_required_quantity integer;
begin
  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'p_requirements must be a json array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_requirements)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each requirement must be an object' using errcode = '22023';
    end if;

    v_resource_type := btrim(coalesce(v_item->>'resource_type', ''));

    if v_item ? 'required_quantity' and v_item->>'required_quantity' is not null then
      v_required_quantity := (v_item->>'required_quantity')::integer;
    else
      v_required_quantity := null;
    end if;

    perform public.set_service_resource_requirement(
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_studio_id := p_studio_id,
      p_service_id := p_service_id,
      p_resource_type := v_resource_type,
      p_required_quantity := v_required_quantity
    );
  end loop;

  return jsonb_build_object('ok', true, 'updated_items', jsonb_array_length(p_requirements));
end;
$$;

revoke all on function public.set_location_operating_hours_for_week(uuid, text, uuid, uuid, jsonb)
from public, anon, authenticated;
grant all on function public.set_location_operating_hours_for_week(uuid, text, uuid, uuid, jsonb)
to service_role;

revoke all on function public.set_employee_working_hours_for_week(uuid, text, uuid, uuid, uuid, jsonb, date, date)
from public, anon, authenticated;
grant all on function public.set_employee_working_hours_for_week(uuid, text, uuid, uuid, uuid, jsonb, date, date)
to service_role;

revoke all on function public.set_service_resource_requirements(uuid, text, uuid, uuid, jsonb)
from public, anon, authenticated;
grant all on function public.set_service_resource_requirements(uuid, text, uuid, uuid, jsonb)
to service_role;
