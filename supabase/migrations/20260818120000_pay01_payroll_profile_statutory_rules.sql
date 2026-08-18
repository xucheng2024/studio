-- PAY-01: restricted payroll profile versions and official statutory rule snapshot.
-- Payroll amounts stay off staff_memberships. History is append-only versions.

create table if not exists public.statutory_payroll_rule_versions (
  id text primary key,
  authority text not null,
  source_url text not null,
  source_effective_from date not null,
  effective_from date not null,
  effective_to date,
  verified_at date not null,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  constraint statutory_payroll_rule_versions_dates check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.employee_payroll_profile_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  job_title text,
  date_of_birth date,
  residency_status text check (residency_status is null or residency_status = any (array['citizen'::text, 'pr'::text, 'foreigner'::text])),
  pr_granted_on date,
  salary_type text check (salary_type is null or salary_type = any (array['monthly'::text, 'hourly'::text])),
  basic_pay_sgd numeric(12,2),
  weekly_hours numeric(6,2),
  cpf_full_rate_elected boolean not null default false,
  shg_fund text check (shg_fund is null or shg_fund = any (array['none'::text, 'cdac'::text, 'ecf'::text, 'mbmf'::text, 'sinda'::text])),
  shg_mode text not null default 'standard' check (shg_mode = any (array['standard'::text, 'opt_out'::text, 'custom_amount'::text])),
  shg_custom_amount_sgd numeric(12,2),
  shg_proof_note text,
  ea_part4_overtime_covered boolean not null default false,
  is_workman boolean not null default false,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint employee_payroll_profile_dates check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists employee_payroll_profile_versions_current_unique
  on public.employee_payroll_profile_versions (employee_id)
  where effective_to is null;

create index if not exists employee_payroll_profile_versions_studio_idx
  on public.employee_payroll_profile_versions (studio_id, employee_id, effective_from desc);

create or replace function public.employee_payroll_profile_versions_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.studio_id = new.studio_id
  ) then
    raise exception 'employee_payroll_profile_versions.employee_id must belong to studio_id'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_payroll_profile_versions_validate_studio_trg on public.employee_payroll_profile_versions;
create trigger employee_payroll_profile_versions_validate_studio_trg
  before insert or update of employee_id, studio_id on public.employee_payroll_profile_versions
  for each row execute function public.employee_payroll_profile_versions_validate_studio();

create or replace function public.prevent_employee_payroll_profile_version_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.studio_id is distinct from old.studio_id
    or new.employee_id is distinct from old.employee_id
    or new.job_title is distinct from old.job_title
    or new.date_of_birth is distinct from old.date_of_birth
    or new.residency_status is distinct from old.residency_status
    or new.pr_granted_on is distinct from old.pr_granted_on
    or new.salary_type is distinct from old.salary_type
    or new.basic_pay_sgd is distinct from old.basic_pay_sgd
    or new.weekly_hours is distinct from old.weekly_hours
    or new.cpf_full_rate_elected is distinct from old.cpf_full_rate_elected
    or new.shg_fund is distinct from old.shg_fund
    or new.shg_mode is distinct from old.shg_mode
    or new.shg_custom_amount_sgd is distinct from old.shg_custom_amount_sgd
    or new.shg_proof_note is distinct from old.shg_proof_note
    or new.ea_part4_overtime_covered is distinct from old.ea_part4_overtime_covered
    or new.is_workman is distinct from old.is_workman
    or new.effective_from is distinct from old.effective_from
  ) then
    raise exception 'payroll profile history cannot be overwritten'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_employee_payroll_profile_version_update_trg on public.employee_payroll_profile_versions;
create trigger prevent_employee_payroll_profile_version_update_trg
  before update on public.employee_payroll_profile_versions
  for each row execute function public.prevent_employee_payroll_profile_version_update();

create or replace function public.pay01_save_payroll_profile_version(
  p_studio_id uuid,
  p_employee_id uuid,
  p_actor_id uuid,
  p_job_title text,
  p_date_of_birth date,
  p_residency_status text,
  p_pr_granted_on date,
  p_salary_type text,
  p_basic_pay_sgd numeric,
  p_weekly_hours numeric,
  p_cpf_full_rate_elected boolean,
  p_shg_fund text,
  p_shg_mode text,
  p_shg_custom_amount_sgd numeric,
  p_shg_proof_note text,
  p_ea_part4_overtime_covered boolean,
  p_is_workman boolean,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current_id uuid;
  v_new_id uuid;
begin
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.studio_id = p_studio_id
  ) then
    raise exception 'employee not in studio' using errcode = '23514';
  end if;

  select id into v_current_id
  from public.employee_payroll_profile_versions
  where employee_id = p_employee_id and effective_to is null
  for update;

  if v_current_id is not null then
    if exists (
      select 1
      from public.employee_payroll_profile_versions current_row
      where current_row.id = v_current_id
        and current_row.effective_from > p_effective_from
    ) then
      raise exception 'new effective_from cannot be earlier than the current version'
        using errcode = '22007';
    end if;
    update public.employee_payroll_profile_versions
    set effective_to = p_effective_from
    where id = v_current_id;
  end if;

  insert into public.employee_payroll_profile_versions (
    studio_id, employee_id, job_title, date_of_birth, residency_status, pr_granted_on,
    salary_type, basic_pay_sgd, weekly_hours, cpf_full_rate_elected, shg_fund, shg_mode,
    shg_custom_amount_sgd, shg_proof_note, ea_part4_overtime_covered, is_workman,
    effective_from, effective_to
  ) values (
    p_studio_id, p_employee_id, p_job_title, p_date_of_birth, p_residency_status, p_pr_granted_on,
    p_salary_type, p_basic_pay_sgd, p_weekly_hours, p_cpf_full_rate_elected, p_shg_fund, p_shg_mode,
    p_shg_custom_amount_sgd, p_shg_proof_note, p_ea_part4_overtime_covered, p_is_workman,
    p_effective_from, null
  )
  returning id into v_new_id;

  perform public.record_strong_audit(
    p_studio_id,
    'payroll_profile_version_saved',
    'employee_payroll_profile_version',
    'user',
    null,
    p_actor_id,
    'owner',
    v_new_id,
    null,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'residency_status', p_residency_status,
      'salary_type', p_salary_type,
      'shg_fund', p_shg_fund,
      'effective_from', p_effective_from
    ),
    null,
    null,
    null
  );

  return v_new_id;
end;
$$;

revoke all on function public.pay01_save_payroll_profile_version(uuid, uuid, uuid, text, date, text, date, text, numeric, numeric, boolean, text, text, numeric, text, boolean, boolean, date) from public;
revoke all on function public.pay01_save_payroll_profile_version(uuid, uuid, uuid, text, date, text, date, text, numeric, numeric, boolean, text, text, numeric, text, boolean, boolean, date) from anon;
revoke all on function public.pay01_save_payroll_profile_version(uuid, uuid, uuid, text, date, text, date, text, numeric, numeric, boolean, text, text, numeric, text, boolean, boolean, date) from authenticated;
grant execute on function public.pay01_save_payroll_profile_version(uuid, uuid, uuid, text, date, text, date, text, numeric, numeric, boolean, text, text, numeric, text, boolean, boolean, date) to service_role;

alter table public.statutory_payroll_rule_versions enable row level security;
alter table public.employee_payroll_profile_versions enable row level security;

revoke all on table public.statutory_payroll_rule_versions from public;
revoke all on table public.statutory_payroll_rule_versions from anon;
revoke all on table public.statutory_payroll_rule_versions from authenticated;
grant all on table public.statutory_payroll_rule_versions to service_role;
revoke all on table public.employee_payroll_profile_versions from public;
revoke all on table public.employee_payroll_profile_versions from anon;
revoke all on table public.employee_payroll_profile_versions from authenticated;
grant all on table public.employee_payroll_profile_versions to service_role;

insert into public.statutory_payroll_rule_versions (
  id, authority, source_url, source_effective_from, effective_from, verified_at, rules
) values (
  'sg-2026-01-01',
  'CPF Board / MOM / SWDA',
  'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
  '2026-01-01',
  '2026-01-01',
  '2026-08-18',
  '{
    "cpf_ow_ceiling_sgd": "8000.00",
    "cpf_annual_ceiling_sgd": "102000.00",
    "cpf_full_rate_wages_above_sgd": "750.00",
    "sdl_rate": "0.0025",
    "sdl_min_sgd": "2.00",
    "sdl_max_sgd": "11.25",
    "sources": {
      "cpf": "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay",
      "ow": "https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling",
      "sdl": "https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy",
      "shg": "https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups",
      "incomplete_month": "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary",
      "overtime": "https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days"
    }
  }'::jsonb
)
on conflict (id) do nothing;
