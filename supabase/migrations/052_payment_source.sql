alter table public.payments
add column if not exists source text;

update public.payments
set source = case
  when package_id is not null then 'package_buy'
  else 'online_booking'
end
where source is null;

update public.payments p
set source = 'walkin'
where exists (
  select 1
  from public.operation_audits oa
  where oa.action = 'frontdesk_walkin'
    and oa.target_type = 'booking'
    and oa.after_state ->> 'payment_id' = p.id::text
);

alter table public.payments
alter column source set default 'online_booking';

update public.payments
set source = 'online_booking'
where source not in ('walkin', 'online_booking', 'package_buy') or source is null;

alter table public.payments
alter column source set not null;

alter table public.payments
add constraint payments_source_check
check (source = any (array['walkin'::text, 'online_booking'::text, 'package_buy'::text]));

create index if not exists idx_payments_studio_source_created_desc
on public.payments using btree (studio_id, source, created_at desc);
