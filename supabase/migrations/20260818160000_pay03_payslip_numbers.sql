-- PAY-03: freeze a payslip number on Finalise so historical slips never recompute.

alter table public.payroll_run_employees
  add column if not exists payslip_number text;

create unique index if not exists payroll_run_employees_payslip_number_unique
  on public.payroll_run_employees (studio_id, payslip_number)
  where payslip_number is not null;

create or replace function public.pay02_transition_run(
  p_run_id uuid,
  p_actor_id uuid,
  p_to_status text,
  p_paid_on date default null,
  p_payment_reference text default null,
  p_void_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_run public.payroll_runs;
  v_open_blockers integer;
begin
  if p_to_status not in ('finalised', 'paid', 'voided') then
    raise exception 'invalid payroll status' using errcode = '22023';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'payroll run not found' using errcode = 'P0002';
  end if;

  if p_to_status = 'finalised' then
    if v_run.status is distinct from 'draft' then
      raise exception 'only draft runs can be finalised' using errcode = 'P0001';
    end if;
    select count(*) into v_open_blockers
    from public.payroll_run_employees
    where payroll_run_id = p_run_id and cardinality(blocker_codes) > 0;
    if v_open_blockers > 0 then
      raise exception 'finalise blocked: % employees still missing required fields', v_open_blockers using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.payroll_run_employees where payroll_run_id = p_run_id) then
      raise exception 'finalise blocked: payroll run has no employees' using errcode = 'P0001';
    end if;
    update public.payroll_runs
    set status = 'finalised', finalised_by = p_actor_id, finalised_at = now()
    where id = p_run_id;
    update public.payroll_run_employees pre
    set payslip_number = 'PAY-' || to_char(v_run.period_start, 'YYYY-MM') || '-' || upper(left(replace(pre.id::text, '-', ''), 8))
    where pre.payroll_run_id = p_run_id
      and pre.payslip_number is null;
  elsif p_to_status = 'paid' then
    if v_run.status is distinct from 'finalised' then
      raise exception 'only finalised runs can be marked paid' using errcode = 'P0001';
    end if;
    if p_paid_on is null then
      raise exception 'paid_on is required' using errcode = '22007';
    end if;
    update public.payroll_runs
    set status = 'paid', paid_on = p_paid_on, payment_reference = p_payment_reference, paid_at = now()
    where id = p_run_id;
  else
    if v_run.status = 'voided' then
      raise exception 'payroll run is already voided' using errcode = 'P0001';
    end if;
    if p_void_reason is null or length(trim(p_void_reason)) = 0 then
      raise exception 'void_reason is required' using errcode = '22023';
    end if;
    delete from public.payroll_commission_locks where payroll_run_id = p_run_id;
    update public.payroll_runs
    set status = 'voided', void_reason = p_void_reason, voided_by = p_actor_id, voided_at = now()
    where id = p_run_id;
  end if;

  perform public.record_strong_audit(
    v_run.studio_id, 'payroll_run_status_changed', 'payroll_run', 'user', null, p_actor_id, 'owner', p_run_id, null,
    jsonb_build_object('from_status', v_run.status, 'to_status', p_to_status),
    null, null, null
  );
  return p_run_id;
end;
$$;

revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from public;
revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from anon;
revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from authenticated;
grant execute on function public.pay02_transition_run(uuid, uuid, text, date, text, text) to service_role;
