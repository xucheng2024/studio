-- ops_pkg02_approval_readonly_checks.sql
-- Read-only production巡检脚本（PKG-02 Maker/Checker）
--
-- 用法（建议通过 scripts/ops-pkg02-approval-checks.sh 调用）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v studio_id="<uuid 或空字符串>" \
--     -f scripts/sql/ops_pkg02_approval_readonly_checks.sql

with scope as (
  select nullif(coalesce(:'studio_id', ''), '')::uuid as studio_id
),
requests as (
  select r.*
  from public.pkg02_adjustment_requests r
  cross join scope s
  where s.studio_id is null or r.studio_id = s.studio_id
),
applied_join as (
  select
    r.id as request_id,
    r.studio_id,
    r.client_package_id,
    r.requested_delta_credits,
    r.requested_value_delta_amount,
    r.currency,
    r.applied_ledger_entry_id,
    l.id as ledger_id,
    l.event_type,
    l.source_type,
    l.source_id,
    l.client_package_id as ledger_client_package_id,
    l.delta_credits,
    l.value_delta_amount,
    l.currency as ledger_currency
  from requests r
  left join public.client_package_ledger_entries l
    on l.id = r.applied_ledger_entry_id
  where r.status = 'applied'
)
select
  check_name,
  expected,
  actual,
  case when actual = 0 then 'pass' else 'fail' end as result
from (
  select
    'self_approval_or_apply'::text as check_name,
    '0'::text as expected,
    count(*)::text as actual
  from requests r
  where r.checker_user_id is not null
    and r.checker_user_id = r.maker_user_id

  union all

  select
    'approved_not_applied_backlog'::text as check_name,
    'monitor (ideally low/stable)'::text as expected,
    count(*)::text as actual
  from requests r
  where r.status = 'approved'

  union all

  select
    'applied_missing_manual_adjustment_ledger'::text as check_name,
    '0'::text as expected,
    count(*)::text as actual
  from applied_join a
  where a.ledger_id is null
     or a.event_type <> 'manual_adjustment'
     or a.source_type <> 'pkg02_adjustment_request'
     or a.source_id <> a.request_id

  union all

  select
    'manual_adjustment_reconcile_diff'::text as check_name,
    '0'::text as expected,
    count(*)::text as actual
  from applied_join a
  where a.ledger_id is not null
    and (
      a.event_type <> 'manual_adjustment'
      or a.source_type <> 'pkg02_adjustment_request'
      or a.source_id <> a.request_id
      or a.ledger_client_package_id <> a.client_package_id
      or a.delta_credits <> a.requested_delta_credits
      or coalesce(a.value_delta_amount, 0::numeric) <> coalesce(a.requested_value_delta_amount, 0::numeric)
      or a.ledger_currency <> a.currency
    )
) t
order by check_name;

-- ====== 异常样本（仅在存在异常时查看） ======

-- 1) 同人自批/自执行
with scope as (
  select nullif(coalesce(:'studio_id', ''), '')::uuid as studio_id
)
select
  r.id,
  r.studio_id,
  r.status,
  r.maker_user_id,
  r.checker_user_id,
  r.updated_at
from public.pkg02_adjustment_requests r
cross join scope s
where (s.studio_id is null or r.studio_id = s.studio_id)
  and r.checker_user_id is not null
  and r.checker_user_id = r.maker_user_id
order by r.updated_at desc
limit 50;

-- 2) approved 但未 applied 的积压
with scope as (
  select nullif(coalesce(:'studio_id', ''), '')::uuid as studio_id
)
select
  r.id,
  r.studio_id,
  r.location_id,
  r.client_package_id,
  r.requested_delta_credits,
  r.requested_value_delta_amount,
  r.currency,
  r.approved_at,
  r.updated_at
from public.pkg02_adjustment_requests r
cross join scope s
where (s.studio_id is null or r.studio_id = s.studio_id)
  and r.status = 'approved'
order by r.approved_at asc nulls last, r.updated_at asc
limit 200;

-- 3) applied 但缺 manual_adjustment ledger
with scope as (
  select nullif(coalesce(:'studio_id', ''), '')::uuid as studio_id
)
select
  r.id as request_id,
  r.studio_id,
  r.applied_ledger_entry_id,
  l.id as ledger_id,
  l.event_type,
  l.source_type,
  l.source_id,
  r.updated_at
from public.pkg02_adjustment_requests r
left join public.client_package_ledger_entries l
  on l.id = r.applied_ledger_entry_id
cross join scope s
where (s.studio_id is null or r.studio_id = s.studio_id)
  and r.status = 'applied'
  and (
    l.id is null
    or l.event_type <> 'manual_adjustment'
    or l.source_type <> 'pkg02_adjustment_request'
    or l.source_id <> r.id
  )
order by r.updated_at desc
limit 100;

-- 4) manual_adjustment 与 request 对账差异
with scope as (
  select nullif(coalesce(:'studio_id', ''), '')::uuid as studio_id
)
select
  r.id as request_id,
  r.studio_id,
  r.client_package_id,
  r.requested_delta_credits,
  r.requested_value_delta_amount,
  r.currency,
  l.id as ledger_id,
  l.client_package_id as ledger_client_package_id,
  l.delta_credits,
  l.value_delta_amount,
  l.currency as ledger_currency,
  l.event_type,
  l.source_type,
  l.source_id,
  r.updated_at
from public.pkg02_adjustment_requests r
join public.client_package_ledger_entries l
  on l.id = r.applied_ledger_entry_id
cross join scope s
where (s.studio_id is null or r.studio_id = s.studio_id)
  and r.status = 'applied'
  and (
    l.event_type <> 'manual_adjustment'
    or l.source_type <> 'pkg02_adjustment_request'
    or l.source_id <> r.id
    or l.client_package_id <> r.client_package_id
    or l.delta_credits <> r.requested_delta_credits
    or coalesce(l.value_delta_amount, 0::numeric) <> coalesce(r.requested_value_delta_amount, 0::numeric)
    or l.currency <> r.currency
  )
order by r.updated_at desc
limit 100;
