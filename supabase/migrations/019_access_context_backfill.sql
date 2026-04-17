-- One-time compatibility backfill after auth/access unification

-- 1) Ensure every studio owner has an active owner grant
insert into public.platform_owner_grants (user_id, is_active, created_at)
select distinct s.owner_id, true, now()
from public.studios s
where s.owner_id is not null
  and not exists (
    select 1
    from public.platform_owner_grants g
    where g.user_id = s.owner_id
      and g.is_active = true
  );

-- 2) Ensure owner membership exists per owned studio
insert into public.staff_memberships (user_id, studio_id, location_id, role, is_active, created_at)
select s.owner_id, s.id, null, 'owner', true, now()
from public.studios s
where s.owner_id is not null
  and not exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = s.owner_id
      and sm.studio_id = s.id
      and sm.role = 'owner'
      and sm.is_active = true
  );

-- 3) De-duplicate active memberships for same scope tuple
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, studio_id, coalesce(location_id::text, 'GLOBAL'), role
      order by created_at desc, id desc
    ) as rn
  from public.staff_memberships
  where is_active = true
)
update public.staff_memberships sm
set is_active = false
from ranked r
where sm.id = r.id
  and r.rn > 1;

-- 4) Expire stale pending invites
update public.staff_invites
set status = 'expired'
where status = 'pending'
  and expires_at <= now();

-- 5) Optional anomaly snapshot for legacy users.role (only if column still exists)
create table if not exists public.auth_access_anomalies (
  id bigserial primary key,
  anomaly_code text not null,
  user_id uuid,
  email text,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);

do $$
declare
  has_role_column boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role'
  ) into has_role_column;

  if has_role_column then
    execute $sql$
      insert into public.auth_access_anomalies (anomaly_code, user_id, email, details)
      select
        'legacy_owner_without_backoffice_access',
        u.id,
        u.email,
        jsonb_build_object('legacy_role', u.role)
      from public.users u
      where u.role = 'owner'
        and not exists (
          select 1 from public.studios s where s.owner_id = u.id
        )
        and not exists (
          select 1 from public.staff_memberships sm
          where sm.user_id = u.id
            and sm.is_active = true
            and sm.role in ('owner', 'manager', 'frontdesk', 'instructor')
        )
        and not exists (
          select 1 from public.platform_owner_grants g
          where g.user_id = u.id
            and g.is_active = true
        );
    $sql$;
  end if;
end $$;
