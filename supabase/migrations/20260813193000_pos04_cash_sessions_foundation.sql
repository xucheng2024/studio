-- POS-04 Batch 3: cash session/day-close foundation.
-- Scope:
--   * pos_cash_sessions table + constraints + indexes
--   * payments.cash_session_id linking guardrails
--   * studio/location consistency validation

create table if not exists public.pos_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  opened_by uuid references public.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_float numeric(12,2) not null default 0 check (opening_float >= 0),
  cash_in numeric(12,2) not null default 0 check (cash_in >= 0),
  cash_out numeric(12,2) not null default 0 check (cash_out >= 0),
  expected_cash numeric(12,2) not null default 0 check (expected_cash >= 0),
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz,
  counted_cash numeric(12,2),
  cash_over_short numeric(12,2),
  status text not null default 'open'
    check (status = any (array['open'::text, 'closed'::text, 'voided'::text])),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_cash_sessions_formula_check check (
    expected_cash = round((opening_float + cash_in - cash_out)::numeric, 2)
    and (
      (counted_cash is null and cash_over_short is null)
      or (
        counted_cash is not null
        and counted_cash >= 0
        and cash_over_short = round((counted_cash - expected_cash)::numeric, 2)
      )
    )
  ),
  constraint pos_cash_sessions_status_fields_check check (
    (
      status = 'open'
      and closed_at is null
      and closed_by is null
      and counted_cash is null
      and cash_over_short is null
    )
    or (
      status in ('closed', 'voided')
      and closed_at is not null
      and closed_by is not null
      and counted_cash is not null
      and cash_over_short is not null
    )
  )
);

create unique index if not exists uq_pos_cash_sessions_open_per_location
  on public.pos_cash_sessions (studio_id, location_id)
  where status = 'open';

create index if not exists idx_pos_cash_sessions_studio_location_opened_desc
  on public.pos_cash_sessions (studio_id, location_id, opened_at desc);

create index if not exists idx_pos_cash_sessions_studio_status_opened_desc
  on public.pos_cash_sessions (studio_id, status, opened_at desc);

create or replace function public.pos_cash_sessions_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
begin
  select studio_id into v_location_studio
  from public.locations
  where id = new.location_id;

  if v_location_studio is null or v_location_studio <> new.studio_id then
    raise exception 'pos_cash_sessions.location_id must belong to studio %', new.studio_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists pos_cash_sessions_validate_refs_trg on public.pos_cash_sessions;
create trigger pos_cash_sessions_validate_refs_trg
  before insert or update of studio_id, location_id on public.pos_cash_sessions
  for each row execute function public.pos_cash_sessions_validate_refs();

-- public.set_updated_at_timestamp() already exists (124_employee_foundation.sql).
drop trigger if exists set_pos_cash_sessions_updated_at on public.pos_cash_sessions;
create trigger set_pos_cash_sessions_updated_at
  before update on public.pos_cash_sessions
  for each row execute function public.set_updated_at_timestamp();

alter table public.payments
add column if not exists cash_session_id uuid references public.pos_cash_sessions(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_cash_session_method_source_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_cash_session_method_source_check;
  end if;
end $$;

alter table public.payments
add constraint payments_cash_session_method_source_check
check (
  cash_session_id is null
  or (payment_method = 'cash' and source = 'pos_sale')
);

create or replace function public.payments_validate_cash_session_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.pos_cash_sessions;
begin
  if new.cash_session_id is null then
    return new;
  end if;

  if coalesce(new.payment_method, '') <> 'cash' or coalesce(new.source, '') <> 'pos_sale' then
    raise exception 'cash_session_id requires payment_method=cash and source=pos_sale'
      using errcode = '23514';
  end if;

  select *
  into v_session
  from public.pos_cash_sessions s
  where s.id = new.cash_session_id;

  if not found then
    raise exception 'cash session % not found', new.cash_session_id using errcode = 'P0002';
  end if;

  if new.studio_id is distinct from v_session.studio_id then
    raise exception 'payment studio_id must match cash session studio_id' using errcode = '23514';
  end if;

  if new.location_id is null or new.location_id is distinct from v_session.location_id then
    raise exception 'payment location_id must match cash session location_id' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_validate_cash_session_refs_trg on public.payments;
create trigger payments_validate_cash_session_refs_trg
  before insert or update of cash_session_id, studio_id, location_id, payment_method, source on public.payments
  for each row execute function public.payments_validate_cash_session_refs();

create index if not exists idx_payments_studio_cash_session_status_paid_desc
  on public.payments (studio_id, cash_session_id, status, paid_at desc)
  where cash_session_id is not null;

create index if not exists idx_payments_cash_session_created_desc
  on public.payments (cash_session_id, created_at desc)
  where cash_session_id is not null;

alter table public.pos_cash_sessions enable row level security;

revoke all on table public.pos_cash_sessions from public;
revoke all on table public.pos_cash_sessions from anon;
revoke all on table public.pos_cash_sessions from authenticated;
grant all on table public.pos_cash_sessions to service_role;
