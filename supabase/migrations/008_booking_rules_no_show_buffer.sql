alter table public.booking_rules
  add column if not exists no_show_buffer_min int not null default 15;

create or replace function public.process_no_show_bookings(
  p_limit int default 500
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_rule record;
  v_refund boolean;
  v_count int := 0;
  v_buffer int;
begin
  for r in
    select
      b.id,
      b.client_package_id,
      b.payment_id,
      b.location_id,
      b.session_id,
      c.studio_id,
      cs.start_time
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.status = 'booked'
      and b.checked_in_at is null
    order by cs.start_time
    limit greatest(coalesce(p_limit, 500), 1)
    for update of b skip locked
  loop
    select
      br.no_show_deduct_credit,
      br.no_show_buffer_min
    into v_rule
    from public.booking_rules br
    where br.studio_id = r.studio_id
      and (br.location_id = r.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    v_buffer := greatest(coalesce(v_rule.no_show_buffer_min, 15), 0);
    if now() < (r.start_time + make_interval(mins => v_buffer)) then
      continue;
    end if;

    v_refund := not coalesce(v_rule.no_show_deduct_credit, true);

    if v_refund then
      if r.client_package_id is not null then
        update public.client_packages
          set credits_left = credits_left + 1
        where id = r.client_package_id;
      end if;
      if r.payment_id is not null then
        update public.payments
          set remaining_uses = remaining_uses + 1
        where id = r.payment_id;
      end if;
    end if;

    update public.bookings
      set status = 'no_show',
          no_show_marked_at = now(),
          credit_policy_applied = jsonb_build_object(
            'policy', 'no_show',
            'credit_returned', v_refund,
            'no_show_deduct_credit', not v_refund,
            'no_show_buffer_min', v_buffer
          )
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.process_no_show_bookings(int) to service_role;
