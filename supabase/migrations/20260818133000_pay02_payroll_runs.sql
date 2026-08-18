-- PAY-02: monthly payroll runs. Amounts live here, not in staff_memberships or audit payloads.

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status = any (array['draft'::text, 'finalised'::text, 'paid'::text, 'voided'::text])),
  rule_version_id text not null references public.statutory_payroll_rule_versions(id),
  company_sdl_sgd numeric(12,2),
  paid_on date,
  payment_reference text,
  void_reason text,
  created_by uuid,
  finalised_by uuid,
  voided_by uuid,
  created_at timestamptz not null default now(),
  finalised_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  constraint payroll_runs_period_check check (period_start = date_trunc('month', period_start)::date and period_end >= period_start)
);

create unique index if not exists payroll_runs_active_period_unique
  on public.payroll_runs (studio_id, period_start)
  where status is distinct from 'voided';

create index if not exists payroll_runs_studio_period_idx
  on public.payroll_runs (studio_id, period_start desc);

create table if not exists public.payroll_run_employees (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_version_id uuid references public.employee_payroll_profile_versions(id) on delete restrict,
  working_days_in_month numeric(6,2),
  days_actually_worked numeric(6,2),
  hours_worked numeric(8,2),
  overtime_hours numeric(8,2),
  contract_overtime_sgd numeric(12,2),
  allowance_sgd numeric(12,2),
  bonus_sgd numeric(12,2),
  unpaid_absence_sgd numeric(12,2),
  other_deduction_sgd numeric(12,2),
  input_note text,
  gross_sgd numeric(12,2) not null default 0,
  total_deductions_sgd numeric(12,2) not null default 0,
  net_sgd numeric(12,2) not null default 0,
  ow_sgd numeric(12,2) not null default 0,
  aw_sgd numeric(12,2) not null default 0,
  employee_cpf_sgd numeric(12,2) not null default 0,
  employer_cpf_sgd numeric(12,2) not null default 0,
  sdl_sgd numeric(12,2) not null default 0,
  shg_sgd numeric(12,2) not null default 0,
  blocker_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);

create table if not exists public.payroll_line_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_employee_id uuid not null references public.payroll_run_employees(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  item_code text not null,
  amount_sgd numeric(12,2) not null,
  wage_class text not null check (wage_class = any (array['ow'::text, 'aw'::text, 'none'::text, 'employer'::text])),
  sort_order integer not null default 0
);

create table if not exists public.payroll_commission_locks (
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  commission_entry_id uuid not null references public.service_commission_entries(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  primary key (payroll_run_id, commission_entry_id)
);

create unique index if not exists payroll_commission_locks_entry_unique
  on public.payroll_commission_locks (commission_entry_id);

create or replace function public.pay02_create_draft_run(
  p_studio_id uuid,
  p_actor_id uuid,
  p_period_start date,
  p_rule_version_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_end date;
begin
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'period_start must be the first day of the month' using errcode = '22007';
  end if;
  v_end := (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date;

  insert into public.payroll_runs (studio_id, period_start, period_end, status, rule_version_id, created_by)
  values (p_studio_id, p_period_start, v_end, 'draft', p_rule_version_id, p_actor_id)
  returning id into v_id;

  perform public.record_strong_audit(
    p_studio_id, 'payroll_run_draft_created', 'payroll_run', 'user', null, p_actor_id, 'owner', v_id, null,
    jsonb_build_object('period_start', p_period_start, 'rule_version_id', p_rule_version_id),
    null, null, null
  );
  return v_id;
exception
  when unique_violation then
    select id into v_id
    from public.payroll_runs
    where studio_id = p_studio_id and period_start = p_period_start and status is distinct from 'voided';
    if v_id is null then
      raise;
    end if;
    return v_id;
end;
$$;

create or replace function public.pay02_replace_draft_snapshot(
  p_run_id uuid,
  p_actor_id uuid,
  p_company_sdl_sgd numeric,
  p_employees jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_run public.payroll_runs;
  v_employee jsonb;
  v_line jsonb;
  v_emp_row_id uuid;
  v_sort integer;
begin
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'payroll run not found' using errcode = 'P0002';
  end if;
  if v_run.status is distinct from 'draft' then
    raise exception 'only draft payroll runs can be recalculated' using errcode = 'P0001';
  end if;

  delete from public.payroll_commission_locks where payroll_run_id = p_run_id;
  delete from public.payroll_line_items
    where payroll_run_employee_id in (select id from public.payroll_run_employees where payroll_run_id = p_run_id);
  delete from public.payroll_run_employees where payroll_run_id = p_run_id;

  update public.payroll_runs
  set company_sdl_sgd = p_company_sdl_sgd
  where id = p_run_id;

  for v_employee in select value from jsonb_array_elements(coalesce(p_employees, '[]'::jsonb))
  loop
    insert into public.payroll_run_employees (
      payroll_run_id, studio_id, employee_id, profile_version_id,
      working_days_in_month, days_actually_worked, hours_worked, overtime_hours, contract_overtime_sgd,
      allowance_sgd, bonus_sgd, unpaid_absence_sgd, other_deduction_sgd, input_note,
      gross_sgd, total_deductions_sgd, net_sgd, ow_sgd, aw_sgd, employee_cpf_sgd, employer_cpf_sgd, sdl_sgd, shg_sgd,
      blocker_codes
    ) values (
      p_run_id, v_run.studio_id, (v_employee->>'employee_id')::uuid, nullif(v_employee->>'profile_version_id','')::uuid,
      nullif(v_employee->>'working_days_in_month','')::numeric, nullif(v_employee->>'days_actually_worked','')::numeric,
      nullif(v_employee->>'hours_worked','')::numeric, nullif(v_employee->>'overtime_hours','')::numeric,
      nullif(v_employee->>'contract_overtime_sgd','')::numeric, nullif(v_employee->>'allowance_sgd','')::numeric,
      nullif(v_employee->>'bonus_sgd','')::numeric, nullif(v_employee->>'unpaid_absence_sgd','')::numeric,
      nullif(v_employee->>'other_deduction_sgd','')::numeric, nullif(v_employee->>'input_note',''),
      coalesce((v_employee->>'gross_sgd')::numeric, 0), coalesce((v_employee->>'total_deductions_sgd')::numeric, 0),
      coalesce((v_employee->>'net_sgd')::numeric, 0), coalesce((v_employee->>'ow_sgd')::numeric, 0),
      coalesce((v_employee->>'aw_sgd')::numeric, 0), coalesce((v_employee->>'employee_cpf_sgd')::numeric, 0),
      coalesce((v_employee->>'employer_cpf_sgd')::numeric, 0), coalesce((v_employee->>'sdl_sgd')::numeric, 0),
      coalesce((v_employee->>'shg_sgd')::numeric, 0),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_employee->'blocker_codes', '[]'::jsonb))), '{}')
    )
    returning id into v_emp_row_id;

    v_sort := 0;
    for v_line in select value from jsonb_array_elements(coalesce(v_employee->'lines', '[]'::jsonb))
    loop
      insert into public.payroll_line_items (payroll_run_employee_id, studio_id, item_code, amount_sgd, wage_class, sort_order)
      values (
        v_emp_row_id, v_run.studio_id, v_line->>'code', (v_line->>'amount_sgd')::numeric, v_line->>'wage_class', v_sort
      );
      v_sort := v_sort + 1;
    end loop;

    insert into public.payroll_commission_locks (payroll_run_id, commission_entry_id, studio_id, employee_id)
    select p_run_id, lock_id::uuid, v_run.studio_id, (v_employee->>'employee_id')::uuid
    from jsonb_array_elements_text(coalesce(v_employee->'commission_entry_ids', '[]'::jsonb)) as lock_id;
  end loop;

  perform public.record_strong_audit(
    v_run.studio_id, 'payroll_run_draft_recalculated', 'payroll_run', 'user', null, p_actor_id, 'owner', p_run_id, null,
    jsonb_build_object('employee_count', jsonb_array_length(coalesce(p_employees, '[]'::jsonb))),
    null, null, null
  );
  return p_run_id;
end;
$$;

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

revoke all on function public.pay02_create_draft_run(uuid, uuid, date, text) from public;
revoke all on function public.pay02_create_draft_run(uuid, uuid, date, text) from anon;
revoke all on function public.pay02_create_draft_run(uuid, uuid, date, text) from authenticated;
grant execute on function public.pay02_create_draft_run(uuid, uuid, date, text) to service_role;
revoke all on function public.pay02_replace_draft_snapshot(uuid, uuid, numeric, jsonb) from public;
revoke all on function public.pay02_replace_draft_snapshot(uuid, uuid, numeric, jsonb) from anon;
revoke all on function public.pay02_replace_draft_snapshot(uuid, uuid, numeric, jsonb) from authenticated;
grant execute on function public.pay02_replace_draft_snapshot(uuid, uuid, numeric, jsonb) to service_role;
revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from public;
revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from anon;
revoke all on function public.pay02_transition_run(uuid, uuid, text, date, text, text) from authenticated;
grant execute on function public.pay02_transition_run(uuid, uuid, text, date, text, text) to service_role;

alter table public.payroll_runs enable row level security;
alter table public.payroll_run_employees enable row level security;
alter table public.payroll_line_items enable row level security;
alter table public.payroll_commission_locks enable row level security;

revoke all on table public.payroll_runs from public;
revoke all on table public.payroll_runs from anon;
revoke all on table public.payroll_runs from authenticated;
grant all on table public.payroll_runs to service_role;
revoke all on table public.payroll_run_employees from public;
revoke all on table public.payroll_run_employees from anon;
revoke all on table public.payroll_run_employees from authenticated;
grant all on table public.payroll_run_employees to service_role;
revoke all on table public.payroll_line_items from public;
revoke all on table public.payroll_line_items from anon;
revoke all on table public.payroll_line_items from authenticated;
grant all on table public.payroll_line_items to service_role;
revoke all on table public.payroll_commission_locks from public;
revoke all on table public.payroll_commission_locks from anon;
revoke all on table public.payroll_commission_locks from authenticated;
grant all on table public.payroll_commission_locks to service_role;
