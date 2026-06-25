create table if not exists public.api_rate_limits (
  key text primary key,
  hits integer not null default 0 check (hits >= 0),
  window_started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;

revoke all on table public.api_rate_limits from public;
revoke all on table public.api_rate_limits from anon;
revoke all on table public.api_rate_limits from authenticated;
grant all on table public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hits integer;
  v_window_started_at timestamptz;
begin
  if p_key is null or btrim(p_key) = '' then
    raise exception 'p_key_required';
  end if;
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'p_window_seconds_invalid';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit_invalid';
  end if;

  insert into public.api_rate_limits as rl (
    key,
    hits,
    window_started_at,
    last_seen_at
  )
  values (
    p_key,
    1,
    v_now,
    v_now
  )
  on conflict (key) do update
    set hits = case
      when rl.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else rl.hits + 1
    end,
    window_started_at = case
      when rl.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else rl.window_started_at
    end,
    last_seen_at = v_now
  returning rl.hits, rl.window_started_at
  into v_hits, v_window_started_at;

  allowed := v_hits <= p_limit;
  remaining := greatest(p_limit - v_hits, 0);
  retry_after_seconds := case
    when v_hits <= p_limit then 0
    else greatest(
      1,
      ceil(extract(epoch from ((v_window_started_at + make_interval(secs => p_window_seconds)) - v_now)))::integer
    )
  end;
  return next;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from anon;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

alter default privileges for role postgres in schema public revoke all on sequences from public;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on sequences from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
