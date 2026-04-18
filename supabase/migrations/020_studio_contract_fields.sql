-- Studio-level contract / lifecycle flags (B2B billing prep; manual suspend via dashboard)

alter table public.studios
  add column if not exists contract_ends_at timestamptz;

alter table public.studios
  add column if not exists contract_status text;

update public.studios
set contract_status = 'active'
where contract_status is null;

alter table public.studios
  alter column contract_status set default 'active';

alter table public.studios
  alter column contract_status set not null;

alter table public.studios
  drop constraint if exists studios_contract_status_check;

alter table public.studios
  add constraint studios_contract_status_check
  check (contract_status in ('active', 'suspended'));
