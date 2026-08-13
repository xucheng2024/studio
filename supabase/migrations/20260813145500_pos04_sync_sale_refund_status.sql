-- POS-04 Batch 1: sync POS sale refund status after payment refund.

create or replace function public.sync_pos_sale_refund_status(
  p_payment_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_payment public.payments;
  v_sale_before public.pos_sales;
  v_sale_after public.pos_sales;
  v_refunded_amount numeric(12,2);
  v_next_status text;
begin
  select *
  into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'P0002';
  end if;

  if v_payment.pos_sale_id is null or coalesce(v_payment.source, '') <> 'pos_sale' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_pos_sale_payment');
  end if;

  select *
  into v_sale_before
  from public.pos_sales s
  where s.id = v_payment.pos_sale_id
    and s.studio_id = v_payment.studio_id
  for update;

  if not found then
    raise exception 'pos sale % not found for payment %', v_payment.pos_sale_id, p_payment_id using errcode = 'P0002';
  end if;

  select round(coalesce(sum(case when p.status = 'refunded' then coalesce(p.amount, 0) else 0 end), 0)::numeric, 2)
  into v_refunded_amount
  from public.payments p
  where p.studio_id = v_sale_before.studio_id
    and p.pos_sale_id = v_sale_before.id;

  if v_refunded_amount <= 0 then
    return jsonb_build_object(
      'ok', true,
      'sale_id', v_sale_before.id,
      'status', v_sale_before.status,
      'refunded_amount', v_sale_before.refunded_amount,
      'unchanged', true
    );
  end if;

  v_next_status := case
    when v_refunded_amount >= round(coalesce(v_sale_before.total_amount, 0)::numeric, 2) then 'refunded'
    else 'partially_refunded'
  end;

  update public.pos_sales
  set status = v_next_status,
      refunded_amount = v_refunded_amount,
      updated_by = p_actor_id
  where id = v_sale_before.id
  returning * into v_sale_after;

  perform public.record_strong_audit(
    p_studio_id := v_sale_after.studio_id,
    p_action := 'pos_sale_refund_synced',
    p_target_type := 'pos_sale',
    p_actor_type := 'user',
    p_location_id := v_sale_after.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_sale_after.id,
    p_before_state := to_jsonb(v_sale_before),
    p_after_state := jsonb_build_object(
      'sale', to_jsonb(v_sale_after),
      'trigger_payment_id', p_payment_id,
      'refund_reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'from_status', v_sale_before.status,
      'to_status', v_sale_after.status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'sale_id', v_sale_after.id,
    'status', v_sale_after.status,
    'refunded_amount', v_sale_after.refunded_amount
  );
end;
$$;

revoke all on function public.sync_pos_sale_refund_status(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.sync_pos_sale_refund_status(uuid, uuid, text, text)
  to service_role;
