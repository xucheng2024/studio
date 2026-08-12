\set ON_ERROR_STOP on

select set_config('apt02.run_id', :'run_id', false);

DO $$
declare
  v_run_id text := current_setting('apt02.run_id');
  v_t1_count integer;
  v_t2_count integer;
  v_all_count integer;
begin
  select count(*) into v_t1_count
  from public.salon_appointments
  where internal_note like ('APT02-CONC-T1-%-' || v_run_id);

  if v_t1_count <> 1 then
    raise exception 'expected exactly 1 appointment for test-1, got %', v_t1_count;
  end if;

  select count(*) into v_t2_count
  from public.salon_appointments
  where internal_note like ('APT02-CONC-T2-%-' || v_run_id);

  if v_t2_count <> 2 then
    raise exception 'expected exactly 2 appointments for test-2, got %', v_t2_count;
  end if;

  select count(*) into v_all_count
  from public.salon_appointments
  where internal_note like ('APT02-CONC-%-' || v_run_id);

  if v_all_count <> 3 then
    raise exception 'expected exactly 3 appointments across concurrency tests, got %', v_all_count;
  end if;

  if exists (
    select 1
    from public.salon_appointments a
    left join lateral (
      select count(*)::integer as history_count
      from public.salon_appointment_status_history h
      where h.appointment_id = a.id
    ) hs on true
    left join lateral (
      select count(*)::integer as active_resource_count
      from public.salon_appointment_resources r
      where r.appointment_id = a.id and r.is_active
    ) rs on true
    where a.internal_note like ('APT02-CONC-%-' || v_run_id)
      and (
        hs.history_count <> 1
        or rs.active_resource_count <> 2
        or a.status <> 'pending'
      )
  ) then
    raise exception 'status history or resource occupancy mismatch for concurrency appointments';
  end if;

  if exists (
    select 1
    from public.salon_appointment_resources r
    join public.salon_appointments a on a.id = r.appointment_id
    where a.internal_note like ('APT02-CONC-%-' || v_run_id)
      and r.is_active
      and (
        r.occupied_from <> a.occupied_from
        or r.occupied_until <> a.occupied_until
        or r.location_id <> a.location_id
        or r.studio_id <> a.studio_id
      )
  ) then
    raise exception 'active resource occupancy rows are inconsistent with appointment occupancy';
  end if;

  if (
    select count(*)
    from public.salon_appointments a
    where a.internal_note = ('APT02-CONC-T1-A-' || v_run_id)
       or a.internal_note = ('APT02-CONC-T1-B-' || v_run_id)
  ) <> 1 then
    raise exception 'expected exactly one winner row among T1-A/T1-B';
  end if;
end
$$;

select 'apt02_concurrency_verification_ok' as result;
