revoke all on function public.assign_payment_invoice_number(uuid) from public;
revoke all on function public.assign_payment_invoice_number(uuid) from anon;
revoke all on function public.assign_payment_invoice_number(uuid) from authenticated;
grant execute on function public.assign_payment_invoice_number(uuid) to service_role;

with ranked_open_subscriptions as (
  select
    id,
    row_number() over (
      partition by studio_id, client_id
      order by
        case when recurring_billing_id is not null then 0 else 1 end,
        case status
          when 'active' then 0
          when 'retrying' then 1
          when 'paused' then 2
          when 'inactive' then 3
          when 'scheduled' then 4
          else 5
        end,
        updated_at desc,
        created_at desc,
        id desc
    ) as rn
  from public.customer_subscriptions
  where status in ('scheduled', 'active', 'retrying', 'inactive', 'paused')
)
update public.customer_subscriptions cs
set
  status = 'canceled',
  canceled_at = coalesce(cs.canceled_at, now()),
  cancel_at_period_end = false,
  cancel_reason = coalesce(cs.cancel_reason, 'duplicate_subscription_guard_backfill'),
  updated_at = now()
from ranked_open_subscriptions ranked
where cs.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists uniq_customer_subscriptions_one_open_per_studio_client
on public.customer_subscriptions (studio_id, client_id)
where status in ('scheduled', 'active', 'retrying', 'inactive', 'paused');

with ranked_pending_series as (
  select
    mzp.id,
    row_number() over (
      partition by mzp.client_id, mzp.series_id
      order by
        case when p.gateway_checkout_url is not null then 0 else 1 end,
        p.expires_at desc nulls last,
        mzp.created_at desc,
        mzp.id desc
    ) as rn
  from public.member_zone_purchases mzp
  left join public.payments p on p.id = mzp.payment_id
  where mzp.lesson_id is null
    and mzp.status = 'pending'
)
update public.member_zone_purchases mzp
set
  status = 'expired',
  updated_at = now()
from ranked_pending_series ranked
where mzp.id = ranked.id
  and ranked.rn > 1;

with ranked_pending_lessons as (
  select
    mzp.id,
    row_number() over (
      partition by mzp.client_id, mzp.lesson_id
      order by
        case when p.gateway_checkout_url is not null then 0 else 1 end,
        p.expires_at desc nulls last,
        mzp.created_at desc,
        mzp.id desc
    ) as rn
  from public.member_zone_purchases mzp
  left join public.payments p on p.id = mzp.payment_id
  where mzp.lesson_id is not null
    and mzp.status = 'pending'
)
update public.member_zone_purchases mzp
set
  status = 'expired',
  updated_at = now()
from ranked_pending_lessons ranked
where mzp.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists uniq_member_zone_pending_series
on public.member_zone_purchases (client_id, series_id)
where lesson_id is null and status = 'pending';

create unique index if not exists uniq_member_zone_pending_lesson
on public.member_zone_purchases (client_id, lesson_id)
where lesson_id is not null and status = 'pending';
