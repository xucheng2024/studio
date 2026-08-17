\set ON_ERROR_STOP on

do $$
declare
  v_studio uuid := 'c2000000-0000-4000-8000-000000000001';
  v_location uuid := 'c2000000-0000-4000-8000-000000000011';
  v_owner uuid := 'c2000000-0000-4000-8000-000000000101';
  v_manager uuid := 'c2000000-0000-4000-8000-000000000102';
  v_frontdesk uuid := 'c2000000-0000-4000-8000-000000000103';
  v_instructor uuid := 'c2000000-0000-4000-8000-000000000104';
begin
  if exists (
    select 1 from (values
      (v_owner, 'crm02-local-owner@example.test'), (v_manager, 'crm02-local-manager@example.test'),
      (v_frontdesk, 'crm02-local-frontdesk@example.test'), (v_instructor, 'crm02-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'CRM-02 local fixture requires exact local Auth identities'; end if;
  insert into public.users (id, email) values
    (v_owner, 'crm02-local-owner@example.test'), (v_manager, 'crm02-local-manager@example.test'),
    (v_frontdesk, 'crm02-local-frontdesk@example.test'), (v_instructor, 'crm02-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'crm02-local-owner@example.test', 'CRM local owner', 'member'), (v_manager, 'crm02-local-manager@example.test', 'CRM local manager', 'member'),
    (v_frontdesk, 'crm02-local-frontdesk@example.test', 'CRM local frontdesk', 'member'), (v_instructor, 'crm02-local-instructor@example.test', 'CRM local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status) values (v_studio, v_owner, 'CRM local UAT', 'crm-local-uat', 'active')
  on conflict (id) do update set owner_id = excluded.owner_id, name = excluded.name, contract_status = excluded.contract_status;
  insert into public.locations (id, studio_id, name, is_active) values (v_location, v_studio, 'CRM Local', true)
  on conflict (id) do update set studio_id = excluded.studio_id, name = excluded.name, is_active = true;
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active) values
    ('c2000000-0000-4000-8000-000000001001', v_manager, v_studio, null, 'manager', true),
    ('c2000000-0000-4000-8000-000000001002', v_frontdesk, v_studio, v_location, 'frontdesk', true),
    ('c2000000-0000-4000-8000-000000001003', v_instructor, v_studio, v_location, 'instructor', true)
  on conflict (id) do update set user_id = excluded.user_id, studio_id = excluded.studio_id, location_id = excluded.location_id, role = excluded.role, is_active = true;
  insert into public.salon_customers (id, studio_id, full_name, email, status, source, preferred_location_id)
    values ('c2000000-0000-4000-8000-000000000301', v_studio, 'CRM local customer', 'crm-local-customer@example.test', 'active', 'frontdesk', v_location)
  on conflict (id) do update set studio_id = excluded.studio_id, full_name = excluded.full_name, email = excluded.email, status = excluded.status, source = excluded.source, preferred_location_id = excluded.preferred_location_id;
end $$;
