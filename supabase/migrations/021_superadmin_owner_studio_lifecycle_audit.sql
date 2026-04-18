-- Superadmin owner/studio lifecycle: atomic disable grant + suspend all studios + audit query index

create index if not exists idx_studios_owner_id on public.studios (owner_id);

create or replace function public.disable_owner_grant_and_suspend_studios(p_owner_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_after_suspended int;
begin
  if p_owner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_owner');
  end if;

  insert into public.platform_owner_grants (user_id, is_active, created_at)
  values (p_owner_user_id, false, now())
  on conflict (user_id)
  do update set is_active = excluded.is_active;

  select count(*)::int into v_total from public.studios where owner_id = p_owner_user_id;

  update public.studios
  set contract_status = 'suspended'
  where owner_id = p_owner_user_id;

  select count(*)::int into v_after_suspended
  from public.studios
  where owner_id = p_owner_user_id
    and contract_status = 'suspended';

  return jsonb_build_object(
    'ok', true,
    'owner_user_id', p_owner_user_id,
    'studio_count', coalesce(v_total, 0),
    'studios_suspended_total', coalesce(v_after_suspended, 0)
  );
end;
$$;

revoke all on function public.disable_owner_grant_and_suspend_studios(uuid) from public;
grant execute on function public.disable_owner_grant_and_suspend_studios(uuid) to service_role;

create index if not exists idx_operation_audits_actor_created_at
  on public.operation_audits (actor_id, created_at desc);
