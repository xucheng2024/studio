-- Cash refunds belong to the drawer that physically pays them out, not the
-- drawer that originally collected the sale.

create table public.pos_cash_refund_movements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  cash_session_id uuid not null references public.pos_cash_sessions(id) on delete restrict,
  sale_id uuid not null references public.pos_sales(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text,
  refunded_by uuid not null references public.users(id) on delete restrict,
  idempotency_key_id uuid not null references public.business_idempotency_keys(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (idempotency_key_id)
);

create index idx_pos_cash_refund_movements_session_occurred
  on public.pos_cash_refund_movements (cash_session_id, occurred_at, id);

alter table public.pos_cash_refund_movements enable row level security;
revoke all on public.pos_cash_refund_movements from public, anon, authenticated;
grant select on public.pos_cash_refund_movements to service_role;

create or replace function public.pos_cash_refund_movements_append_only()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin raise exception 'pos_cash_refund_movements is append-only' using errcode = '55000'; end;
$$;
create trigger pos_cash_refund_movements_no_update before update on public.pos_cash_refund_movements
  for each row execute function public.pos_cash_refund_movements_append_only();
create trigger pos_cash_refund_movements_no_delete before delete on public.pos_cash_refund_movements
  for each row execute function public.pos_cash_refund_movements_append_only();

-- Preserve the proven line-item refund logic and add the drawer movement in a
-- transactional wrapper. The original idempotency claim remains authoritative.
alter function public.refund_pos_sale_items(uuid, text, uuid, uuid, jsonb, text, text, text)
  rename to refund_pos_sale_items_base;

create function public.refund_pos_sale_items(p_actor_id uuid,p_actor_role text,p_studio_id uuid,p_sale_id uuid,p_items jsonb,p_reason text default null,p_idempotency_key text default null,p_request_hash text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_sale public.pos_sales; v_payment public.payments; v_session public.pos_cash_sessions;
  v_result jsonb; v_key uuid; v_available numeric(12,2); v_movement uuid;
begin
  select * into v_sale from public.pos_sales where id=p_sale_id and studio_id=p_studio_id for update;
  if not found then raise exception 'sale % not found in studio %', p_sale_id,p_studio_id using errcode='P0002'; end if;
  if p_actor_role not in ('owner','manager') then raise exception 'cash refunds require owner or manager' using errcode='42501'; end if;
  perform public.pos01_assert_actor_scope(p_studio_id,p_actor_id,p_actor_role,v_sale.location_id);
  select * into v_payment from public.payments where studio_id=p_studio_id and pos_sale_id=v_sale.id for update;
  if not found then raise exception 'payment for sale % not found', p_sale_id using errcode='23514'; end if;
  if v_payment.payment_method='cash' and v_payment.source='pos_sale' then
    select * into v_session from public.pos_cash_sessions where studio_id=p_studio_id and location_id=v_sale.location_id and status='open' for update;
    if not found then raise exception 'no open cash session for cash refund at location %',v_sale.location_id using errcode='23514'; end if;
  end if;
  v_result := public.refund_pos_sale_items_base(p_actor_id,p_actor_role,p_studio_id,p_sale_id,p_items,p_reason,p_idempotency_key,p_request_hash);
  if v_payment.payment_method<>'cash' or v_payment.source<>'pos_sale' then return v_result; end if;
  select id into v_key from public.business_idempotency_keys where studio_id=p_studio_id and operation_scope='pos_sale:refund_items' and idempotency_key=p_idempotency_key;
  select id into v_movement from public.pos_cash_refund_movements where idempotency_key_id=v_key;
  if v_movement is null then
    select round(s.opening_float + coalesce(sum(p.amount) filter (where p.status in ('paid','refunded')),0) - coalesce((select sum(amount) from public.pos_cash_refund_movements where cash_session_id=v_session.id),0),2)
      into v_available from public.pos_cash_sessions s left join public.payments p on p.cash_session_id=s.id and p.payment_method='cash' and p.source='pos_sale' where s.id=v_session.id group by s.id;
    if v_available < coalesce((v_result->>'refund_delta')::numeric,0) then raise exception 'insufficient expected cash in open cash session %',v_session.id using errcode='23514'; end if;
    insert into public.pos_cash_refund_movements(studio_id,location_id,cash_session_id,sale_id,payment_id,amount,currency,reason,refunded_by,idempotency_key_id)
      values(p_studio_id,v_sale.location_id,v_session.id,p_sale_id,v_payment.id,(v_result->>'refund_delta')::numeric,v_payment.currency,nullif(btrim(coalesce(p_reason,'')),''),p_actor_id,v_key) returning id into v_movement;
  end if;
  return v_result || jsonb_build_object('cash_refund_movement_id',v_movement,'cash_refund_session_id',v_session.id);
end $$;

-- Alter the existing close function body only at its accounting query; all
-- idempotency, audit, locking and response behavior remain unchanged.
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.close_pos_cash_session(uuid,text,uuid,uuid,numeric,text,text,text)'::regprocedure) into v_def;
  v_old := 'round(coalesce(sum(case when p.status = ''refunded'' then coalesce(p.amount, 0) else 0 end), 0)::numeric, 2)';
  if position(v_old in v_def)=0 then raise exception 'unexpected close_pos_cash_session definition'; end if;
  v_new := 'round(coalesce((select sum(m.amount) from public.pos_cash_refund_movements m where m.cash_session_id = v_session_before.id), 0)::numeric, 2)';
  execute replace(v_def, v_old, v_new);
end $$;

revoke all on function public.refund_pos_sale_items(uuid,text,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.refund_pos_sale_items(uuid,text,uuid,uuid,jsonb,text,text,text) to service_role;
revoke all on function public.refund_pos_sale_items_base(uuid,text,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
