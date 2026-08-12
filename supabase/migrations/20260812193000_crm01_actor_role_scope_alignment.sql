-- CRM-01 follow-up: align declared actor_role with effective scope role
-- to prevent mixed-location role escalation in audits/mutations.

create or replace function public.crm01_assert_actor_scope(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer public.salon_customers;
  v_is_studio_owner boolean := false;
  v_has_exact_global_role boolean := false;
  v_has_exact_location_role boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  v_customer := public.crm01_assert_customer_in_studio(p_studio_id, p_salon_customer_id);
  perform public.crm01_assert_location_in_studio(p_studio_id, p_location_id);

  if p_actor_role in ('system', 'service') then
    return;
  end if;

  if p_actor_role = 'client' then
    if v_customer.user_id is null or v_customer.user_id <> p_actor_id then
      raise exception 'client actor % does not own customer %', p_actor_id, p_salon_customer_id
        using errcode = '42501';
    end if;
    return;
  end if;

  if p_actor_role not in ('owner', 'manager', 'frontdesk', 'instructor') then
    raise exception 'invalid actor role %', p_actor_role using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.studios s
    where s.id = p_studio_id
      and s.owner_id = p_actor_id
  ) into v_is_studio_owner;

  if v_is_studio_owner then
    if p_actor_role = 'owner' then
      return;
    end if;

    raise exception 'studio owner % must declare role owner, got %', p_actor_id, p_actor_role
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.is_active = true
      and sm.location_id is null
      and sm.role = p_actor_role
  ) into v_has_exact_global_role;

  if v_has_exact_global_role then
    return;
  end if;

  if p_location_id is null then
    raise exception 'actor % has no exact role scope (%), studio-global or location-specific', p_actor_id, p_actor_role
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.location_id = p_location_id
      and sm.is_active = true
      and sm.role = p_actor_role
  ) into v_has_exact_location_role;

  if not v_has_exact_location_role then
    raise exception 'actor % has no exact role scope (%) for location %', p_actor_id, p_actor_role, p_location_id
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from anon;
revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from authenticated;
grant execute on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) to service_role;
