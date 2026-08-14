\set ON_ERROR_STOP on

begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

\echo '=== COM-01 UAT evidence pack ==='
\echo 'run_id: ' :run_id

\echo '\n[1] sales/payment/item/appointment base facts'
select
  s.id as sale_id,
  s.note,
  s.location_id,
  s.status as sale_status,
  s.paid_at as sale_paid_at,
  p.id as payment_id,
  p.reference_code,
  p.payment_method,
  p.status as payment_status,
  p.paid_at as payment_paid_at,
  i.id as sale_item_id,
  i.item_type,
  i.salon_appointment_id,
  i.employee_id,
  i.service_id,
  i.total_amount,
  i.refunded_amount,
  i.fulfilled_at,
  a.status as appointment_status,
  a.updated_at as appointment_updated_at
from public.pos_sales s
left join public.payments p
  on p.pos_sale_id = s.id
 and p.studio_id = s.studio_id
 and p.source = 'pos_sale'
left join public.pos_sale_items i
  on i.sale_id = s.id
 and i.studio_id = s.studio_id
left join public.salon_appointments a
  on a.id = i.salon_appointment_id
where s.note like :'run_id' || '%'
order by s.created_at, i.created_at;

\echo '\n[2] commission entries (earned + refund_reversal)'
select
  e.id as entry_id,
  e.created_at,
  e.studio_id,
  e.location_id,
  e.employee_id,
  e.service_id,
  e.pos_sale_id,
  s.note as sale_note,
  e.pos_sale_item_id,
  e.salon_appointment_id,
  e.payment_id,
  e.source_type,
  e.entry_type,
  e.amount,
  e.currency,
  e.rule_version,
  e.refund_checkpoint_key,
  e.origin_entry_id
from public.service_commission_entries e
join public.pos_sales s on s.id = e.pos_sale_id
where s.note like :'run_id' || '%'
order by e.created_at, e.id;

\echo '\n[3] unique earned-per-item check'
select
  e.pos_sale_item_id,
  count(*) filter (where e.entry_type = 'earned') as earned_count,
  count(*) filter (where e.entry_type = 'refund_reversal') as reversal_count,
  min(e.created_at) as first_entry_at,
  max(e.created_at) as last_entry_at
from public.service_commission_entries e
join public.pos_sales s on s.id = e.pos_sale_id
where s.note like :'run_id' || '%'
group by e.pos_sale_item_id
order by e.pos_sale_item_id;

\echo '\n[4] strong audit logs (fulfill/earned/reversal/payment)'
select
  l.created_at,
  l.action,
  l.target_type,
  l.target_id,
  l.actor_role,
  l.location_id,
  l.idempotency_key_id,
  jsonb_strip_nulls(jsonb_build_object(
    'entryId', l.after_state->>'entryId',
    'posSaleItemId', l.after_state->>'posSaleItemId',
    'sourceType', l.after_state->>'sourceType',
    'amount', l.after_state->>'amount',
    'ruleVersion', l.after_state->>'ruleVersion',
    'fulfilledAt', l.after_state->>'fulfilledAt',
    'fulfilledBy', l.after_state->>'fulfilledBy',
    'deltaAbs', l.after_state->>'deltaAbs',
    'targetReversedAbs', l.after_state->>'targetReversedAbs',
    'fromStatus', l.after_state->>'from_status',
    'toStatus', l.after_state->>'to_status',
    'paymentFromStatus', l.after_state->>'payment_from_status',
    'paymentToStatus', l.after_state->>'payment_to_status',
    'paymentMethod', l.after_state->>'payment_method',
    'receiptNumber', l.after_state->>'receipt_number'
  )) as safe_after_state
from public.strong_audit_logs l
where l.action in (
  'com01_walkin_fulfilled',
  'com01_commission_earned_recorded',
  'com01_commission_refund_reversal_recorded',
  'pos_cash_sale_completed',
  'pos_hitpay_sale_completed'
)
and (
  (l.target_type = 'pos_sale' and l.target_id in (
    select s.id
    from public.pos_sales s
    where s.note like :'run_id' || '%'
  ))
  or
  (l.target_type = 'pos_sale_item' and l.target_id in (
    select i.id
    from public.pos_sale_items i
    join public.pos_sales s on s.id = i.sale_id
    where s.note like :'run_id' || '%'
  ))
  or
  (l.target_type = 'service_commission_entries' and l.target_id in (
    select e.id
    from public.service_commission_entries e
    join public.pos_sales s on s.id = e.pos_sale_id
    where s.note like :'run_id' || '%'
  ))
)
order by l.created_at, l.id;

\echo '\n[5] business idempotency keys for COM-01 and POS payments'
select
  k.created_at,
  k.operation_scope,
  k.idempotency_key,
  k.status,
  k.completed_at,
  left(k.error_summary, 200) as error_summary
from public.business_idempotency_keys k
where (
  k.operation_scope like 'com01:%'
  or k.operation_scope like 'pos_sale:%'
)
and (
  k.idempotency_key like lower(:'run_id') || '%'
  or k.idempotency_key like :'run_id' || '%'
)
order by k.created_at, k.id;

commit;
