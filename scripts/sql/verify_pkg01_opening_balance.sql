-- verify_pkg01_opening_balance.sql
-- Validates PKG-01 opening balance backfill + conflict reporting + rerunnable behavior.

set check_function_bodies = off;

DO $$
declare
  v_studio_id uuid := 'c1111111-1111-1111-1111-111111111111'::uuid;
  v_location_id uuid := 'c2222222-2222-2222-2222-222222222222'::uuid;
  v_owner_id uuid := 'c3333333-3333-3333-3333-333333333333'::uuid;
  v_actor_id uuid := 'c4444444-4444-4444-4444-444444444444'::uuid;

  v_user_mapped uuid := 'c5555555-5555-5555-5555-555555555555'::uuid;
  v_user_unmapped uuid := 'c6666666-6666-6666-6666-666666666666'::uuid;

  v_customer_mapped uuid := 'c7777777-7777-7777-7777-777777777777'::uuid;

  v_pkg_a uuid := 'c8888888-8888-8888-8888-888888888888'::uuid;
  v_pkg_b uuid := 'c9999999-9999-9999-9999-999999999999'::uuid;

  v_cp_mapped uuid := 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  v_cp_unmapped uuid := 'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;

  v_dry_run jsonb;
  v_run_1 jsonb;
  v_run_2 jsonb;
  v_opening_count integer;
  v_conflict_count integer;
  v_delta_sum integer;
begin
  insert into public.users (id, email)
  values
    (v_owner_id, 'owner+pkg01-opening@example.com'),
    (v_actor_id, 'actor+pkg01-opening@example.com'),
    (v_user_mapped, 'mapped+pkg01-opening@example.com'),
    (v_user_unmapped, 'unmapped+pkg01-opening@example.com')
  on conflict (id) do nothing;

  insert into public.studios (id, owner_id)
  values (v_studio_id, v_owner_id)
  on conflict (id) do update set owner_id = excluded.owner_id;

  insert into public.locations (id, studio_id, name)
  values (v_location_id, v_studio_id, 'PKG01 Opening Verify Location')
  on conflict (id) do update set studio_id = excluded.studio_id;

  insert into public.salon_customers (
    id,
    studio_id,
    user_id,
    full_name,
    email,
    status,
    source
  )
  values (
    v_customer_mapped,
    v_studio_id,
    v_user_mapped,
    'Mapped Opening Customer',
    'mapped+pkg01-opening@example.com',
    'active',
    'imported'
  )
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        user_id = excluded.user_id,
        merged_into_id = null;

  insert into public.packages (id, studio_id, name, price, credits, expiry_days, location_id, is_active)
  values
    (v_pkg_a, v_studio_id, 'Opening Pkg A', 120, 8, 60, v_location_id, true),
    (v_pkg_b, v_studio_id, 'Opening Pkg B', 90, 5, 30, v_location_id, true)
  on conflict (id) do update
    set studio_id = excluded.studio_id,
        location_id = excluded.location_id,
        credits = excluded.credits,
        expiry_days = excluded.expiry_days,
        is_active = excluded.is_active;

  insert into public.client_packages (
    id, client_id, package_id, credits_left, expiry_date, created_at,
    package_name_snapshot, package_credits_snapshot, package_expiry_days_snapshot
  )
  values
    (v_cp_mapped, v_user_mapped, v_pkg_a, 3, now() + interval '30 days', now() - interval '10 days', 'Opening Pkg A', 8, 60),
    (v_cp_unmapped, v_user_unmapped, v_pkg_b, 2, now() + interval '20 days', now() - interval '8 days', 'Opening Pkg B', 5, 30)
  on conflict (id) do update
    set client_id = excluded.client_id,
        package_id = excluded.package_id,
        credits_left = excluded.credits_left,
        expiry_date = excluded.expiry_date,
        package_name_snapshot = excluded.package_name_snapshot,
        package_credits_snapshot = excluded.package_credits_snapshot,
        package_expiry_days_snapshot = excluded.package_expiry_days_snapshot;

  delete from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and event_type = 'opening_balance'
    and source_type = 'client_package_opening_balance'
    and source_id in (v_cp_mapped, v_cp_unmapped);

  delete from public.pkg01_opening_balance_conflicts
  where studio_id = v_studio_id
    and source_client_package_id in (v_cp_mapped, v_cp_unmapped);

  v_dry_run := public.backfill_pkg01_opening_balance(
    p_studio_id := v_studio_id,
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_limit := 100,
    p_dry_run := true
  );

  if coalesce((v_dry_run->>'ok')::boolean, false) is false
     or coalesce((v_dry_run->>'inserted')::integer, -1) <> 1
     or coalesce((v_dry_run->>'conflicts')::integer, -1) <> 1 then
    raise exception 'PKG-01 opening dry-run unexpected: %', v_dry_run;
  end if;

  select count(*)
  into v_opening_count
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and event_type = 'opening_balance';

  if v_opening_count <> 0 then
    raise exception 'PKG-01 opening dry-run should not write ledger rows, got %', v_opening_count;
  end if;

  v_run_1 := public.backfill_pkg01_opening_balance(
    p_studio_id := v_studio_id,
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_limit := 100,
    p_dry_run := false
  );

  if coalesce((v_run_1->>'ok')::boolean, false) is false
     or coalesce((v_run_1->>'inserted')::integer, -1) <> 1 then
    raise exception 'PKG-01 opening run #1 unexpected: %', v_run_1;
  end if;

  select count(*), coalesce(sum(delta_credits), 0)
  into v_opening_count, v_delta_sum
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and event_type = 'opening_balance'
    and source_type = 'client_package_opening_balance';

  if v_opening_count <> 1 or v_delta_sum <> 3 then
    raise exception 'PKG-01 opening expected one ledger row (+3), got count=% sum=%', v_opening_count, v_delta_sum;
  end if;

  select count(*)
  into v_conflict_count
  from public.pkg01_opening_balance_conflicts c
  where c.studio_id = v_studio_id
    and c.source_client_package_id = v_cp_unmapped
    and c.conflict_code = 'missing_salon_customer'
    and c.status = 'open';

  if v_conflict_count <> 1 then
    raise exception 'PKG-01 opening expected one missing_salon_customer conflict, got %', v_conflict_count;
  end if;

  v_run_2 := public.backfill_pkg01_opening_balance(
    p_studio_id := v_studio_id,
    p_actor_id := v_actor_id,
    p_actor_role := 'owner',
    p_limit := 100,
    p_dry_run := false
  );

  if coalesce((v_run_2->>'ok')::boolean, false) is false
     or coalesce((v_run_2->>'inserted')::integer, -1) <> 0
     or coalesce((v_run_2->>'skipped_existing')::integer, -1) < 1 then
    raise exception 'PKG-01 opening rerun unexpected: %', v_run_2;
  end if;

  select count(*)
  into v_opening_count
  from public.client_package_ledger_entries
  where studio_id = v_studio_id
    and event_type = 'opening_balance'
    and source_type = 'client_package_opening_balance';

  if v_opening_count <> 1 then
    raise exception 'PKG-01 opening rerun must remain one ledger row, got %', v_opening_count;
  end if;

  raise notice 'verify_pkg01_opening_balance: ok';
end;
$$;
