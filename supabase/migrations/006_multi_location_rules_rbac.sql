-- Lightweight multi-location + booking rules + basic RBAC

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  location_id uuid references public.locations (id) on delete cascade,
  cancel_cutoff_hours int not null default 12,
  late_cancel_deduct_credit boolean not null default true,
  no_show_deduct_credit boolean not null default true,
  allow_waitlist boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly')),
  interval_value int not null default 1,
  by_weekday text,
  start_date date not null,
  end_date date,
  start_time time not null,
  duration_min int not null default 60,
  capacity int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  location_id uuid references public.locations (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'frontdesk', 'instructor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Extend existing entities with location and operational fields
alter table public.instructors
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists is_active boolean not null default true;

alter table public.classes
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists is_active boolean not null default true;

alter table public.class_sessions
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists capacity int,
  add column if not exists status text not null default 'scheduled',
  add column if not exists recurring_rule_id uuid references public.recurring_rules (id) on delete set null;

alter table public.class_sessions
  drop constraint if exists class_sessions_status_check;

alter table public.class_sessions
  add constraint class_sessions_status_check check (status in ('scheduled', 'cancelled', 'completed'));

alter table public.packages
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists type text not null default 'class_pack',
  add column if not exists is_active boolean not null default true;

alter table public.packages
  drop constraint if exists packages_type_check;

alter table public.packages
  add constraint packages_type_check check (type in ('single', 'class_pack', 'monthly'));

alter table public.bookings
  add column if not exists location_id uuid references public.locations (id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists checked_in_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check check (
    status in ('pending', 'booked', 'cancelled', 'attended', 'no_show', 'late_cancel')
  );

alter table public.payments
  add column if not exists location_id uuid references public.locations (id) on delete set null;

-- Backfill default location for each studio
insert into public.locations (studio_id, name)
select s.id, s.name || ' - Main'
from public.studios s
where not exists (
  select 1 from public.locations l where l.studio_id = s.id
);

update public.classes c
set location_id = l.id
from public.locations l
where l.studio_id = c.studio_id
  and c.location_id is null;

update public.instructors i
set location_id = l.id
from public.locations l
where l.studio_id = i.studio_id
  and i.location_id is null;

update public.class_sessions cs
set location_id = c.location_id,
    capacity = coalesce(cs.capacity, c.capacity, cs.spots_left)
from public.classes c
where c.id = cs.class_id
  and (cs.location_id is null or cs.capacity is null);

update public.packages p
set location_id = null
where p.location_id is null;

update public.packages
set type = case
  when is_drop_in = true then 'single'
  else 'class_pack'
end
where type is null;

update public.bookings b
set location_id = cs.location_id
from public.class_sessions cs
where cs.id = b.session_id
  and b.location_id is null;

update public.payments p
set location_id = coalesce(
  b.location_id,
  pkg.location_id,
  cls.location_id
)
from public.bookings b
left join public.class_sessions cs on cs.id = b.session_id
left join public.classes cls on cls.id = cs.class_id
left join public.client_packages cp on cp.id = b.client_package_id
left join public.packages pkg on pkg.id = cp.package_id
where p.booking_id = b.id
  and p.location_id is null;

update public.payments p
set location_id = pkg.location_id
from public.packages pkg
where p.location_id is null
  and p.package_id is not null
  and pkg.id = p.package_id;

-- Ensure profiles for existing users
insert into public.user_profiles (id, email, role)
select u.id, u.email, u.role
from public.users u
on conflict (id) do update set
  email = excluded.email,
  role = excluded.role;

-- Membership mirror for owners
insert into public.staff_memberships (user_id, studio_id, role)
select s.owner_id, s.id, 'owner'
from public.studios s
where not exists (
  select 1 from public.staff_memberships sm
  where sm.user_id = s.owner_id and sm.studio_id = s.id and sm.role = 'owner'
);

-- Basic indexes
create index if not exists idx_locations_studio on public.locations (studio_id);
create index if not exists idx_classes_location on public.classes (location_id);
create index if not exists idx_sessions_location on public.class_sessions (location_id, start_time);
create index if not exists idx_bookings_location on public.bookings (location_id, created_at desc);
create index if not exists idx_payments_location on public.payments (location_id, created_at desc);
create index if not exists idx_staff_memberships_user on public.staff_memberships (user_id, studio_id);

-- RLS for new tables
alter table public.locations enable row level security;
alter table public.booking_rules enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.user_profiles enable row level security;
alter table public.staff_memberships enable row level security;

create policy "user_profiles_self" on public.user_profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "staff_memberships_self_read" on public.staff_memberships
  for select using (auth.uid() = user_id);

create policy "locations_staff_read" on public.locations
  for select using (
    exists (
      select 1 from public.staff_memberships sm
      where sm.studio_id = locations.studio_id
        and sm.user_id = auth.uid()
        and sm.is_active = true
    )
    or exists (
      select 1 from public.studios s
      where s.id = locations.studio_id and s.owner_id = auth.uid()
    )
  );

create policy "locations_owner_manage" on public.locations
  for all using (
    exists (
      select 1 from public.studios s
      where s.id = locations.studio_id and s.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.studios s
      where s.id = locations.studio_id and s.owner_id = auth.uid()
    )
  );

create policy "booking_rules_staff_read" on public.booking_rules
  for select using (
    exists (
      select 1 from public.staff_memberships sm
      where sm.studio_id = booking_rules.studio_id
        and sm.user_id = auth.uid()
        and sm.is_active = true
    )
    or exists (
      select 1 from public.studios s
      where s.id = booking_rules.studio_id and s.owner_id = auth.uid()
    )
  );

create policy "booking_rules_owner_manage" on public.booking_rules
  for all using (
    exists (
      select 1 from public.studios s
      where s.id = booking_rules.studio_id and s.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.studios s
      where s.id = booking_rules.studio_id and s.owner_id = auth.uid()
    )
  );

create policy "recurring_rules_staff_read" on public.recurring_rules
  for select using (
    exists (
      select 1
      from public.classes c
      left join public.staff_memberships sm on sm.studio_id = c.studio_id and sm.user_id = auth.uid() and sm.is_active = true
      left join public.studios s on s.id = c.studio_id
      where c.id = recurring_rules.class_id
        and (sm.user_id is not null or s.owner_id = auth.uid())
    )
  );

grant select on public.locations, public.booking_rules, public.recurring_rules, public.user_profiles, public.staff_memberships to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.booking_rules to authenticated;
grant select, insert, update, delete on public.recurring_rules to authenticated;
grant select, insert, update, delete on public.staff_memberships to authenticated;
