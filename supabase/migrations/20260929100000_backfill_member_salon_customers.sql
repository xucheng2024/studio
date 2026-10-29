-- salon_customers was only filled from member_studio_memberships once, by the
-- salon_customer_foundation backfill. Members who joined later had no customer
-- row until they opened the booking page, so the dashboard Clients list missed
-- them. The app now creates the row on join; this fills the gap for existing
-- members. Guests with the same email are linked first through the existing
-- conservative linker (ambiguous matches become conflicts, never auto-merged).
-- Idempotent.

do $$
declare
  v_member record;
begin
  for v_member in
    select distinct m.user_id, nullif(lower(trim(coalesce(up.email, u.email))), '') as email
    from public.member_studio_memberships m
    join public.users u on u.id = m.user_id
    left join public.user_profiles up on up.id = m.user_id
    where not exists (
      select 1 from public.salon_customers c
      where c.studio_id = m.studio_id and c.user_id = m.user_id
    )
  loop
    if v_member.email is not null then
      perform public.link_guest_salon_customers_for_user(v_member.user_id, v_member.email);
    end if;
  end loop;
end;
$$;

insert into public.salon_customers (studio_id, user_id, full_name, email, phone, status, source)
select
  m.studio_id,
  m.user_id,
  left(coalesce(nullif(trim(up.full_name), ''), nullif(trim(up.email), ''), nullif(trim(u.email), ''), 'Unnamed customer'), 200),
  nullif(lower(trim(coalesce(up.email, u.email))), ''),
  nullif(trim(up.phone), ''),
  case when m.status = 'active' then 'active' else 'inactive' end,
  'imported'
from public.member_studio_memberships m
join public.users u on u.id = m.user_id
left join public.user_profiles up on up.id = m.user_id
where not exists (
  select 1 from public.salon_customers c
  where c.studio_id = m.studio_id and c.user_id = m.user_id
)
on conflict (studio_id, user_id) where user_id is not null do nothing;
