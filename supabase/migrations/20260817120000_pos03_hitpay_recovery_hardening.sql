-- POS-03 recovery hardening:
-- * keep gateway settlement evidence atomic for webhook and proactive-sync paths
-- * restrict webhook exception records to server-side operations

alter table public.hitpay_webhook_failures enable row level security;

revoke all on table public.hitpay_webhook_failures from public, anon, authenticated;
grant select, insert on table public.hitpay_webhook_failures to service_role;

-- Preserve the public RPC signature while extending it in a wrapper. It locks
-- sale then payment before updating pending settlement evidence, so the core
-- RPC's audit snapshot includes it and paid replays cannot overwrite it.
alter function public.complete_pos_hitpay_sale(uuid, uuid, uuid, uuid, text, text, text, uuid)
  rename to complete_pos_hitpay_sale_core;

create function public.complete_pos_hitpay_sale(
  p_studio_id uuid,
  p_payment_id uuid default null,
  p_sale_id uuid default null,
  p_provider_event_id uuid default null,
  p_gateway_payment_id text default null,
  p_gateway_status text default null,
  p_gateway_payload text default null,
  p_verified_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_sale_id uuid;
  v_payment_id uuid;
  v_payment_status text;
begin
  if p_sale_id is not null then
    v_sale_id := p_sale_id;
  else
    select pos_sale_id into v_sale_id
    from public.payments
    where id = p_payment_id and studio_id = p_studio_id;
  end if;

  if v_sale_id is not null then
    perform 1 from public.pos_sales
    where id = v_sale_id and studio_id = p_studio_id
    for update;
  end if;

  if p_payment_id is not null then
    select id, status into v_payment_id, v_payment_status
    from public.payments
    where id = p_payment_id and studio_id = p_studio_id
    for update;
  elsif v_sale_id is not null then
    select id, status into v_payment_id, v_payment_status
    from public.payments
    where pos_sale_id = v_sale_id and studio_id = p_studio_id
    for update;
  end if;

  -- Only a pending settlement may acquire provider evidence. This prevents a
  -- replayed webhook with a different body from mutating an already-paid fact.
  if v_payment_id is not null and v_payment_status = 'pending' then
    update public.payments
    set gateway_status = coalesce(nullif(btrim(p_gateway_status), ''), gateway_status),
        gateway_payload = coalesce(nullif(btrim(p_gateway_payload), ''), gateway_payload),
        gateway_refund_payment_id = coalesce(nullif(btrim(p_gateway_payment_id), ''), gateway_refund_payment_id)
    where id = v_payment_id;
  end if;

  v_result := public.complete_pos_hitpay_sale_core(
    p_studio_id,
    p_payment_id,
    p_sale_id,
    p_provider_event_id,
    p_gateway_payment_id,
    p_gateway_status,
    p_gateway_payload,
    p_verified_by
  );

  return v_result;
end;
$$;

revoke all on function public.complete_pos_hitpay_sale(uuid, uuid, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_pos_hitpay_sale(uuid, uuid, uuid, uuid, text, text, text, uuid)
  to service_role;

revoke all on function public.complete_pos_hitpay_sale_core(uuid, uuid, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
