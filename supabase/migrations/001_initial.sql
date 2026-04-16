-- Yoga studio MVP schema (run in Supabase SQL editor or via CLI)
-- Extensions
create extension if not exists "pgcrypto";

-- Public users mirror auth (trigger below)
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null check (role in ('owner', 'client')),
  created_at timestamptz not null default now()
);

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  studio_id uuid not null references public.studios (id) on delete cascade
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  title text not null,
  description text,
  instructor_id uuid references public.instructors (id) on delete set null,
  capacity int not null check (capacity > 0),
  duration_min int not null default 60
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  spots_left int not null check (spots_left >= 0)
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null,
  credits int not null check (credits > 0),
  price numeric(12, 2) not null,
  expiry_days int,
  is_drop_in boolean not null default false
);

create table if not exists public.client_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users (id) on delete cascade,
  package_id uuid not null references public.packages (id) on delete cascade,
  credits_left int not null check (credits_left >= 0),
  expiry_date timestamptz
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios (id) on delete set null,
  client_id uuid not null references public.users (id) on delete cascade,
  amount numeric(12, 2) not null,
  type text not null check (type in ('single', 'package')),
  status text not null default 'paid' check (status in ('paid', 'pending', 'failed')),
  remaining_uses int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  client_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'attended')),
  client_package_id uuid references public.client_packages (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_bookings_active_per_session_client
  on public.bookings (session_id, client_id)
  where status = 'booked';

-- Auth: create profile row
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'client')
  )
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic book: package credits first (non drop-in), then drop-in packs, then single-payment credits
create or replace function public.book_session(p_session_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.class_sessions%rowtype;
  cp_rec public.client_packages%rowtype;
  pay_rec public.payments%rowtype;
  new_booking_id uuid;
begin
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if exists (
    select 1 from public.bookings
    where session_id = p_session_id and client_id = p_client_id and status = 'booked'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_booked');
  end if;

  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  select cp.*
  into cp_rec
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.credits_left > 0
    and (cp.expiry_date is null or cp.expiry_date > now())
  order by pkg.is_drop_in asc, cp.expiry_date asc nulls last, cp.created_at asc
  limit 1
  for update of cp;

  if found then
    update public.client_packages
      set credits_left = credits_left - 1
    where id = cp_rec.id;

    insert into public.bookings (session_id, client_id, status, client_package_id)
    values (p_session_id, p_client_id, 'booked', cp_rec.id)
    returning id into new_booking_id;

    update public.class_sessions
      set spots_left = spots_left - 1
    where id = p_session_id;

    return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'package');
  end if;

  select *
  into pay_rec
  from public.payments
  where client_id = p_client_id
    and type = 'single'
    and status = 'paid'
    and remaining_uses > 0
  order by created_at asc
  limit 1
  for update;

  if found then
    update public.payments
      set remaining_uses = remaining_uses - 1
    where id = pay_rec.id;

    insert into public.bookings (session_id, client_id, status, payment_id)
    values (p_session_id, p_client_id, 'booked', pay_rec.id)
    returning id into new_booking_id;

    update public.class_sessions
      set spots_left = spots_left - 1
    where id = p_session_id;

    return jsonb_build_object('ok', true, 'booking_id', new_booking_id, 'source', 'single');
  end if;

  return jsonb_build_object('ok', false, 'error', 'no_credits');
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  update public.class_sessions
    set spots_left = spots_left + 1
  where id = b.session_id;

  if b.client_package_id is not null then
    update public.client_packages
      set credits_left = credits_left + 1
    where id = b.client_package_id;
  end if;

  if b.payment_id is not null then
    update public.payments
      set remaining_uses = remaining_uses + 1
    where id = b.payment_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- RLS
alter table public.users enable row level security;
alter table public.studios enable row level security;
alter table public.instructors enable row level security;
alter table public.classes enable row level security;
alter table public.class_sessions enable row level security;
alter table public.packages enable row level security;
alter table public.client_packages enable row level security;
alter table public.payments enable row level security;
alter table public.bookings enable row level security;

create policy "users_self" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "owners_read_booking_clients" on public.users
  for select using (
    exists (
      select 1
      from public.bookings b
      join public.class_sessions cs on cs.id = b.session_id
      join public.classes c on c.id = cs.class_id
      join public.studios s on s.id = c.studio_id
      where b.client_id = users.id
        and s.owner_id = auth.uid()
    )
  );

create policy "studios_read_future_booking" on public.studios
  for select using (true);

create policy "studios_owner_write" on public.studios
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "instructors_read" on public.instructors
  for select using (true);

create policy "instructors_owner_write" on public.instructors
  for all using (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  );

create policy "classes_read" on public.classes
  for select using (true);

create policy "classes_owner_write" on public.classes
  for all using (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  );

create policy "sessions_read" on public.class_sessions
  for select using (true);

create policy "sessions_owner_write" on public.class_sessions
  for all using (
    exists (
      select 1 from public.classes c
      join public.studios s on s.id = c.studio_id
      where c.id = class_id and s.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.classes c
      join public.studios s on s.id = c.studio_id
      where c.id = class_id and s.owner_id = auth.uid()
    )
  );

create policy "packages_read" on public.packages
  for select using (true);

create policy "packages_owner_write" on public.packages
  for all using (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid())
  );

create policy "client_packages_self" on public.client_packages
  for select using (auth.uid() = client_id);

create policy "client_packages_owner_select" on public.client_packages
  for select using (
    exists (
      select 1 from public.packages p
      join public.studios s on s.id = p.studio_id
      where p.id = client_packages.package_id
        and s.owner_id = auth.uid()
    )
  );

create policy "payments_self" on public.payments
  for select using (auth.uid() = client_id);

create policy "payments_owner_select" on public.payments
  for select using (
    exists (
      select 1 from public.studios s
      where s.id = payments.studio_id
        and s.owner_id = auth.uid()
    )
  );

create policy "bookings_client_select" on public.bookings
  for select using (auth.uid() = client_id);

create policy "bookings_owner_select" on public.bookings
  for select using (
    exists (
      select 1 from public.class_sessions cs
      join public.classes c on c.id = cs.class_id
      join public.studios s on s.id = c.studio_id
      where cs.id = session_id and s.owner_id = auth.uid()
    )
  );

create policy "bookings_owner_update" on public.bookings
  for update using (
    exists (
      select 1 from public.class_sessions cs
      join public.classes c on c.id = cs.class_id
      join public.studios s on s.id = c.studio_id
      where cs.id = session_id and s.owner_id = auth.uid()
    )
  );

-- Bookings / payment writes: Next.js route handlers use service role (bypasses RLS).

grant usage on schema public to anon, authenticated;

grant select on public.studios, public.classes, public.class_sessions, public.packages, public.instructors
  to anon, authenticated;

grant select on public.bookings, public.client_packages, public.payments, public.users
  to authenticated;

grant select, insert, update, delete on public.studios to authenticated;
grant select, insert, update, delete on public.instructors to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.class_sessions to authenticated;
grant select, insert, update, delete on public.packages to authenticated;

grant update on public.bookings to authenticated;

grant execute on function public.book_session(uuid, uuid) to service_role;
grant execute on function public.cancel_booking(uuid) to service_role;
