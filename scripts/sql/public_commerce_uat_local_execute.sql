\set ON_ERROR_STOP on

select set_config('public_uat.studio_id', :'public_uat_studio_id', false);
select set_config('public_uat.location_id', :'public_uat_location_id', false);
select set_config('public_uat.service_id', :'public_uat_service_id', false);
select set_config('public_uat.package_id', :'public_uat_package_id', false);
select set_config('public_uat.event_id', :'public_uat_event_id', false);

do $$
declare
  v_studio uuid := current_setting('public_uat.studio_id')::uuid;
  v_location uuid := current_setting('public_uat.location_id')::uuid;
  v_service uuid := current_setting('public_uat.service_id')::uuid;
  v_package uuid := current_setting('public_uat.package_id')::uuid;
  v_event uuid := current_setting('public_uat.event_id')::uuid;
  v_owner uuid := 'a003631d-5d38-4151-84cf-11923566323b';
  v_instructor uuid := '81f40905-459a-44c8-862f-5fc7ce589ab5';
begin
  if exists (
    select 1 from (values
      (v_owner, 'public-local-owner@example.test'), (v_instructor, 'public-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'public local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'public-local-owner@example.test'), (v_instructor, 'public-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'public-local-owner@example.test', 'public local owner', 'member'),
    (v_instructor, 'public-local-instructor@example.test', 'public local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, 'public local UAT', 'public-local-' || left(v_studio::text, 8), 'active')
  on conflict (id) do update set owner_id = excluded.owner_id, name = excluded.name, public_slug = excluded.public_slug, contract_status = excluded.contract_status;
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'public Local', true)
  on conflict (id) do update set studio_id = excluded.studio_id, name = excluded.name, is_active = true;
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values
      (gen_random_uuid(), v_owner, v_studio, null, 'owner', true),
      (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true)
  on conflict do nothing;
  insert into public.studio_services (id, studio_id, title, summary, price, currency, is_active, enable_enquiry, enable_payment, share_slug)
    values (v_service, v_studio, 'Public UAT service', 'Quantity checkout verification', 0, 'SGD', true, false, true, 'public-uat-service')
  on conflict (id) do update set studio_id = excluded.studio_id, title = excluded.title, summary = excluded.summary, price = excluded.price, is_active = true, enable_enquiry = false, enable_payment = true, share_slug = excluded.share_slug;
  insert into public.packages (id, studio_id, location_id, name, credits, price, expiry_days, type, is_active, share_slug)
    values (v_package, v_studio, v_location, 'Public UAT package', 3, 0, 30, 'class_pack', true, null)
  on conflict (id) do update set studio_id = excluded.studio_id, location_id = excluded.location_id, name = excluded.name, credits = excluded.credits, price = excluded.price, expiry_days = excluded.expiry_days, is_active = true, share_slug = null;
  insert into public.events (id, studio_id, location_id, title, description, start_time, end_time, capacity, spots_left, price, currency, is_active, share_slug)
    values (v_event, v_studio, v_location, 'Public UAT past event', 'Past events shortcut verification', now() - interval '2 days', now() - interval '1 day', 20, 20, 0, 'SGD', true, 'public-uat-past-event')
  on conflict (id) do update set studio_id = excluded.studio_id, location_id = excluded.location_id, title = excluded.title, start_time = excluded.start_time, end_time = excluded.end_time, is_active = true;
end $$;
