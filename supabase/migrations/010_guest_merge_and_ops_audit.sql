create table if not exists public.guest_merge_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  email text not null,
  merged_bookings int not null default 0,
  merged_payments int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.operation_audits (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_operation_audits_created_at on public.operation_audits (created_at desc);
create index if not exists idx_operation_audits_action on public.operation_audits (action);

create or replace function public.merge_guest_records_for_user(
  p_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_bookings_count int := 0;
  v_payments_count int := 0;
begin
  if p_user_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  update public.bookings b
  set client_id = p_user_id
  where b.client_id is null
    and b.guest_email is not null
    and lower(trim(b.guest_email)) = v_email;
  get diagnostics v_bookings_count = row_count;

  update public.payments p
  set client_id = p_user_id
  where p.client_id is null
    and (
      (p.booking_id is not null and exists (
        select 1
        from public.bookings b
        where b.id = p.booking_id and lower(trim(coalesce(b.guest_email, ''))) = v_email
      ))
    );
  get diagnostics v_payments_count = row_count;

  insert into public.guest_merge_audits (user_id, email, merged_bookings, merged_payments)
  values (p_user_id, v_email, v_bookings_count, v_payments_count);

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'merged_bookings', v_bookings_count,
    'merged_payments', v_payments_count
  );
end;
$$;

create or replace function public.handle_user_guest_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.merge_guest_records_for_user(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_public_user_merge_guest on public.users;
create trigger on_public_user_merge_guest
  after insert or update of email on public.users
  for each row execute function public.handle_user_guest_merge();

grant execute on function public.merge_guest_records_for_user(uuid, text) to service_role, authenticated;
