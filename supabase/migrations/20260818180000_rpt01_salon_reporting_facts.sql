-- RPT-01: salon reporting facts aggregated in the database.
-- Charts stay in RPT-02. Do not invent inventory or loyalty numbers.

create index if not exists idx_salon_appointments_rpt01_scope
  on public.salon_appointments (studio_id, location_id, employee_id, service_id, starts_at, status);

create index if not exists idx_pos_sale_items_rpt01_scope
  on public.pos_sale_items (studio_id, location_id, item_type, employee_id, service_id);

create index if not exists idx_payments_rpt01_pos_finance
  on public.payments (studio_id, pos_sale_id, status)
  where pos_sale_id is not null and status in ('paid', 'refunded');

create index if not exists idx_service_commission_entries_rpt01_scope
  on public.service_commission_entries (studio_id, location_id, employee_id, service_id, created_at);

create or replace function public.rpt01_sgt_date(p_ts timestamptz)
returns date
language sql
immutable
as $$
  select case when p_ts is null then null else (timezone('Asia/Singapore', p_ts))::date end;
$$;

create or replace function public.get_rpt01_reporting_facts(
  p_studio_id uuid,
  p_from date,
  p_to date,
  p_location_id uuid default null,
  p_unassigned boolean default false,
  p_employee_id uuid default null,
  p_service_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_prior_from date;
  v_prior_to date;
  v_now date := public.rpt01_sgt_date(now());
  v_result jsonb;
begin
  if p_studio_id is null then
    raise exception 'studio_id is required' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'date range is invalid' using errcode = '22007';
  end if;
  if (p_to - p_from) > 366 then
    raise exception 'date range cannot exceed 366 days' using errcode = '22023';
  end if;

  v_prior_from := (p_from - ((p_to - p_from) + 1));
  v_prior_to := (p_from - 1);

  with appt as (
    select
      a.id,
      a.status,
      a.location_id,
      coalesce(nullif(a.location_name_snapshot, ''), 'Unassigned') as location_label,
      a.employee_id,
      coalesce(nullif(a.employee_name_snapshot, ''), 'Unassigned') as employee_label,
      a.service_id,
      coalesce(nullif(a.service_title_snapshot, ''), 'Unassigned') as service_label,
      a.salon_customer_id,
      public.rpt01_sgt_date(a.starts_at) as sgt_date
    from public.salon_appointments a
    where a.studio_id = p_studio_id
      and public.rpt01_sgt_date(a.starts_at) between p_from and p_to
      and (p_employee_id is null or a.employee_id = p_employee_id)
      and (p_service_id is null or a.service_id = p_service_id)
      and (
        case
          when p_unassigned then a.location_id is null
          when p_location_id is null then true
          else a.location_id = p_location_id
        end
      )
  ),
  appt_closed as (
    select * from appt where status in ('completed', 'cancelled', 'no_show')
  ),
  appt_outcome as (
    select jsonb_build_object(
      'open', jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'confirmed', count(*) filter (where status = 'confirmed'),
        'checked_in', count(*) filter (where status = 'checked_in'),
        'in_progress', count(*) filter (where status = 'in_progress')
      ),
      'closed', jsonb_build_object(
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'no_show', count(*) filter (where status = 'no_show')
      )
    ) as payload
    from appt
  ),
  appt_by_location as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'location_id', location_id,
        'location_label', coalesce(location_label, 'Unassigned'),
        'completed', completed,
        'cancelled', cancelled,
        'no_show', no_show
      ) order by location_label),
      '[]'::jsonb
    ) as payload
    from (
      select
        location_id,
        location_label,
        count(*) filter (where status = 'completed') as completed,
        count(*) filter (where status = 'cancelled') as cancelled,
        count(*) filter (where status = 'no_show') as no_show
      from appt_closed
      group by location_id, location_label
    ) rows
  ),
  sale_items as (
    select
      i.id,
      i.item_type,
      i.location_id,
      coalesce(nullif(s.location_id::text, ''), 'unassigned') as location_key,
      i.employee_id,
      i.service_id,
      i.product_id,
      i.item_name_snapshot,
      i.total_amount,
      i.refunded_amount,
      p.status as payment_status,
      public.rpt01_sgt_date(coalesce(p.verified_at, p.paid_at, p.created_at)) as paid_date,
      public.rpt01_sgt_date(p.refunded_at) as refund_date
    from public.pos_sale_items i
    join public.pos_sales s on s.id = i.sale_id
    join public.payments p on p.pos_sale_id = s.id and p.status in ('paid', 'refunded')
    where i.studio_id = p_studio_id
      and s.status in ('paid', 'partially_refunded', 'refunded')
      and (p_employee_id is null or i.employee_id = p_employee_id)
      and (p_service_id is null or i.service_id = p_service_id)
      and (
        case
          when p_unassigned then i.location_id is null
          when p_location_id is null then true
          else i.location_id = p_location_id
        end
      )
  ),
  sale_in_range as (
    select
      *,
      case when paid_date between p_from and p_to then total_amount else 0 end as gross_in_range,
      case
        when payment_status = 'refunded' and refund_date between p_from and p_to then total_amount
        when payment_status = 'paid' and paid_date between p_from and p_to then refunded_amount
        else 0
      end as refund_in_range
    from sale_items
    where (paid_date between p_from and p_to)
       or (refund_date between p_from and p_to)
  ),
  sale_totals as (
    select jsonb_build_object(
      'service', jsonb_build_object(
        'gross', coalesce(sum(gross_in_range) filter (where item_type = 'service'), 0),
        'refunds', coalesce(sum(refund_in_range) filter (where item_type = 'service'), 0),
        'net', coalesce(sum(gross_in_range - refund_in_range) filter (where item_type = 'service'), 0)
      ),
      'retail', jsonb_build_object(
        'gross', coalesce(sum(gross_in_range) filter (where item_type = 'product'), 0),
        'refunds', coalesce(sum(refund_in_range) filter (where item_type = 'product'), 0),
        'net', coalesce(sum(gross_in_range - refund_in_range) filter (where item_type = 'product'), 0)
      )
    ) as payload
    from sale_in_range
  ),
  sale_by_location as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'location_id', location_id,
        'location_label', coalesce(loc.name, 'Unassigned'),
        'service_net', service_net,
        'retail_net', retail_net
      ) order by coalesce(loc.name, 'Unassigned')),
      '[]'::jsonb
    ) as payload
    from (
      select
        location_id,
        coalesce(sum(gross_in_range - refund_in_range) filter (where item_type = 'service'), 0) as service_net,
        coalesce(sum(gross_in_range - refund_in_range) filter (where item_type = 'product'), 0) as retail_net
      from sale_in_range
      group by location_id
    ) rows
    left join public.locations loc on loc.id = rows.location_id
  ),
  sale_by_service as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'service_id', service_id,
        'service_label', service_label,
        'gross', gross,
        'refunds', refunds,
        'net', net
      ) order by service_label),
      '[]'::jsonb
    ) as payload
    from (
      select
        service_id,
        coalesce(nullif(item_name_snapshot, ''), 'Unassigned') as service_label,
        sum(gross_in_range) as gross,
        sum(refund_in_range) as refunds,
        sum(gross_in_range - refund_in_range) as net
      from sale_in_range
      where item_type = 'service'
      group by service_id, item_name_snapshot
    ) rows
  ),
  sale_by_product as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'product_id', product_id,
        'product_label', product_label,
        'gross', gross,
        'refunds', refunds,
        'net', net
      ) order by product_label),
      '[]'::jsonb
    ) as payload
    from (
      select
        product_id,
        coalesce(nullif(item_name_snapshot, ''), 'Unassigned') as product_label,
        sum(gross_in_range) as gross,
        sum(refund_in_range) as refunds,
        sum(gross_in_range - refund_in_range) as net
      from sale_in_range
      where item_type = 'product'
      group by product_id, item_name_snapshot
    ) rows
  ),
  yoy_items as (
    select
      i.item_type,
      i.total_amount,
      i.refunded_amount,
      p.status as payment_status,
      public.rpt01_sgt_date(coalesce(p.verified_at, p.paid_at, p.created_at)) as paid_date,
      public.rpt01_sgt_date(p.refunded_at) as refund_date
    from public.pos_sale_items i
    join public.pos_sales s on s.id = i.sale_id
    join public.payments p on p.pos_sale_id = s.id and p.status in ('paid', 'refunded')
    where i.studio_id = p_studio_id
      and s.status in ('paid', 'partially_refunded', 'refunded')
      and i.item_type in ('service', 'product')
      and (p_employee_id is null or i.employee_id = p_employee_id)
      and (p_service_id is null or i.service_id = p_service_id)
      and (
        case
          when p_unassigned then i.location_id is null
          when p_location_id is null then true
          else i.location_id = p_location_id
        end
      )
  ),
  yoy as (
    select jsonb_build_object(
      'current_net', coalesce(sum(
        case
          when paid_date between p_from and p_to then total_amount
          else 0
        end
        -
        case
          when payment_status = 'refunded' and refund_date between p_from and p_to then total_amount
          when payment_status = 'paid' and paid_date between p_from and p_to then refunded_amount
          else 0
        end
      ), 0),
      'prior_net', coalesce(sum(
        case
          when paid_date between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date then total_amount
          else 0
        end
        -
        case
          when payment_status = 'refunded' and refund_date between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date then total_amount
          when payment_status = 'paid' and paid_date between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date then refunded_amount
          else 0
        end
      ), 0)
    ) as payload
    from yoy_items
  ),
  first_visit as (
    select salon_customer_id, min(public.rpt01_sgt_date(starts_at)) as first_date
    from public.salon_appointments
    where studio_id = p_studio_id and status = 'completed'
    group by salon_customer_id
  ),
  completed_visits as (
    select distinct salon_customer_id, sgt_date
    from appt
    where status = 'completed'
  ),
  customers as (
    select jsonb_build_object(
      'unique_customers', count(distinct cv.salon_customer_id),
      'visits', count(*),
      'new_customers', count(distinct cv.salon_customer_id) filter (where fv.first_date between p_from and p_to),
      'returning_customers', count(distinct cv.salon_customer_id) filter (where fv.first_date is not null and fv.first_date < p_from)
    ) as payload
    from completed_visits cv
    left join first_visit fv on fv.salon_customer_id = cv.salon_customer_id
  ),
  new_cohort as (
    select fv.salon_customer_id, fv.first_date
    from first_visit fv
    where fv.first_date between p_from and p_to
  ),
  new_retention as (
    select jsonb_build_object(
      'cohort_from', p_from,
      'cohort_to', p_to,
      'window_days', 90,
      'denominator', count(*),
      'incomplete', count(*) filter (where first_date + 90 > v_now),
      'numerator', count(*) filter (
        where first_date + 90 <= v_now
          and exists (
            select 1
            from public.salon_appointments a
            where a.studio_id = p_studio_id
              and a.salon_customer_id = new_cohort.salon_customer_id
              and a.status = 'completed'
              and public.rpt01_sgt_date(a.starts_at) > first_date
              and public.rpt01_sgt_date(a.starts_at) <= first_date + 90
          )
      )
    ) as payload
    from new_cohort
  ),
  repeat_pool as (
    select fv.salon_customer_id
    from first_visit fv
    where (
      select count(*) from public.salon_appointments a
      where a.studio_id = p_studio_id
        and a.salon_customer_id = fv.salon_customer_id
        and a.status = 'completed'
        and public.rpt01_sgt_date(a.starts_at) < p_from
    ) >= 2
    and exists (
      select 1 from public.salon_appointments a
      where a.studio_id = p_studio_id
        and a.salon_customer_id = fv.salon_customer_id
        and a.status = 'completed'
        and public.rpt01_sgt_date(a.starts_at) between v_prior_from and v_prior_to
    )
  ),
  repeat_retention as (
    select jsonb_build_object(
      'prior_from', v_prior_from,
      'prior_to', v_prior_to,
      'denominator', count(*),
      'numerator', count(*) filter (
        where exists (
          select 1 from public.salon_appointments a
          where a.studio_id = p_studio_id
            and a.salon_customer_id = repeat_pool.salon_customer_id
            and a.status = 'completed'
            and public.rpt01_sgt_date(a.starts_at) between p_from and p_to
        )
      )
    ) as payload
    from repeat_pool
  ),
  employee_rows as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'employee_id', employee_id,
        'employee_label', employee_label,
        'completed_services', completed_services,
        'net_service_sales', net_service_sales,
        'net_commission', net_commission
      ) order by employee_label),
      '[]'::jsonb
    ) as payload
    from (
      select
        coalesce(appt_emp.employee_id, sale_emp.employee_id, com_emp.employee_id) as employee_id,
        coalesce(appt_emp.employee_label, sale_emp.employee_label, com_emp.employee_label, 'Unassigned') as employee_label,
        coalesce(appt_emp.completed_services, 0) as completed_services,
        coalesce(sale_emp.net_service_sales, 0) as net_service_sales,
        coalesce(com_emp.net_commission, 0) as net_commission
      from (
        select employee_id, employee_label, count(*) as completed_services
        from appt
        where status = 'completed'
        group by employee_id, employee_label
      ) appt_emp
      full outer join (
        select
          employee_id,
          coalesce(emp.display_name, 'Unassigned') as employee_label,
          sum(gross_in_range - refund_in_range) as net_service_sales
        from sale_in_range s
        left join public.employees emp on emp.id = s.employee_id
        where s.item_type = 'service'
        group by s.employee_id, emp.display_name
      ) sale_emp on sale_emp.employee_id is not distinct from appt_emp.employee_id
      full outer join (
        select
          c.employee_id,
          coalesce(emp.display_name, 'Unassigned') as employee_label,
          sum(c.amount) as net_commission
        from public.service_commission_entries c
        left join public.employees emp on emp.id = c.employee_id
        where c.studio_id = p_studio_id
          and public.rpt01_sgt_date(c.created_at) between p_from and p_to
          and (p_employee_id is null or c.employee_id = p_employee_id)
          and (p_service_id is null or c.service_id = p_service_id)
          and (
            case
              when p_unassigned then c.location_id is null
              when p_location_id is null then true
              else c.location_id = p_location_id
            end
          )
        group by c.employee_id, emp.display_name
      ) com_emp on com_emp.employee_id is not distinct from coalesce(appt_emp.employee_id, sale_emp.employee_id)
    ) merged
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'appointment_outcome', (select payload from appt_outcome) || jsonb_build_object(
      'by_location', (select payload from appt_by_location)
    ),
    'sales', (select payload from sale_totals) || jsonb_build_object(
      'by_location', (select payload from sale_by_location),
      'by_service', (select payload from sale_by_service),
      'by_product', (select payload from sale_by_product),
      'yoy', (select payload from yoy)
    ),
    'customers', (select payload from customers) || jsonb_build_object(
      'new_retention', (select payload from new_retention),
      'repeat_retention', (select payload from repeat_retention)
    ),
    'employees', (select payload from employee_rows)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$fn$;

revoke all on function public.rpt01_sgt_date(timestamptz) from public, anon, authenticated;
grant execute on function public.rpt01_sgt_date(timestamptz) to service_role;

revoke all on function public.get_rpt01_reporting_facts(uuid, date, date, uuid, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_rpt01_reporting_facts(uuid, date, date, uuid, boolean, uuid, uuid)
  to service_role;
