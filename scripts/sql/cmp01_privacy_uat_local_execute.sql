\set ON_ERROR_STOP on

select set_config('cmp01_uat.studio_id', :'cmp01_uat_studio_id', false);
select set_config('cmp01_uat.location_id', :'cmp01_uat_location_id', false);
select set_config('cmp01_uat.customer_id', :'cmp01_uat_customer_id', false);

do $$
declare
  v_studio uuid := current_setting('cmp01_uat.studio_id')::uuid;
  v_location uuid := current_setting('cmp01_uat.location_id')::uuid;
  v_customer uuid := current_setting('cmp01_uat.customer_id')::uuid;
  v_owner uuid := '7b146e5e-b857-4c92-8cb1-ebbe08691396';
  v_instructor uuid := 'eb5f762c-b277-4a24-8f7e-9af5323f004e';
begin
  if exists (
    select 1 from (values
      (v_owner, 'cmp01-local-owner@example.test'), (v_instructor, 'cmp01-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'cmp01 local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'cmp01-local-owner@example.test'), (v_instructor, 'cmp01-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'cmp01-local-owner@example.test', 'cmp01 local owner', 'member'),
    (v_instructor, 'cmp01-local-instructor@example.test', 'cmp01 local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, 'cmp01 local UAT', 'cmp01-local-' || left(v_studio::text, 8), 'active')
  on conflict (id) do update set owner_id = excluded.owner_id, name = excluded.name, public_slug = excluded.public_slug, contract_status = excluded.contract_status;
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'cmp01 Local', true)
  on conflict (id) do update set studio_id = excluded.studio_id, name = excluded.name, is_active = true;
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);
  insert into public.salon_customers (id, studio_id, full_name, email, phone, status, source, preferred_location_id)
    values (v_customer, v_studio, 'CMP01 local customer', 'cmp01-local-customer@example.test', '81230001', 'active', 'frontdesk', v_location)
  on conflict (id) do update set studio_id = excluded.studio_id, full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, status = excluded.status;
end $$;
