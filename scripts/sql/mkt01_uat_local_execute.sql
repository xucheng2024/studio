\set ON_ERROR_STOP on

select set_config('mkt01_uat.studio_id', :'mkt01_uat_studio_id', false);
select set_config('mkt01_uat.location_id', :'mkt01_uat_location_id', false);
select set_config('mkt01_uat.eligible_customer_id', :'mkt01_uat_eligible_customer_id', false);
select set_config('mkt01_uat.suppressed_customer_id', :'mkt01_uat_suppressed_customer_id', false);
select set_config('mkt01_uat.no_consent_customer_id', :'mkt01_uat_no_consent_customer_id', false);

do $$
declare
  v_studio uuid := current_setting('mkt01_uat.studio_id')::uuid;
  v_location uuid := current_setting('mkt01_uat.location_id')::uuid;
  v_owner uuid := 'a1000000-0000-4000-8000-000000000101';
  v_instructor uuid := 'a1000000-0000-4000-8000-000000000102';
  v_eligible uuid := current_setting('mkt01_uat.eligible_customer_id')::uuid;
  v_suppressed uuid := current_setting('mkt01_uat.suppressed_customer_id')::uuid;
  v_no_consent uuid := current_setting('mkt01_uat.no_consent_customer_id')::uuid;
begin
  if exists (
    select 1 from (values
      (v_owner, 'mkt01-local-owner@example.test'), (v_instructor, 'mkt01-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'MKT-01 local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'mkt01-local-owner@example.test'), (v_instructor, 'mkt01-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'mkt01-local-owner@example.test', 'MKT local owner', 'member'), (v_instructor, 'mkt01-local-instructor@example.test', 'MKT local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
    values (v_studio, v_owner, 'MKT local UAT', 'mkt-local-' || left(v_studio::text, 8), 'active');
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'MKT Local', true);
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);

  insert into public.salon_customers (id, studio_id, full_name, email, status, source, preferred_location_id) values
    (v_eligible, v_studio, 'MKT eligible customer', 'mkt-eligible-' || left(v_eligible::text, 8) || '@example.test', 'active', 'frontdesk', v_location),
    (v_suppressed, v_studio, 'MKT suppressed customer', 'mkt-suppressed-' || left(v_suppressed::text, 8) || '@example.test', 'active', 'frontdesk', v_location),
    (v_no_consent, v_studio, 'MKT no consent customer', 'mkt-noconsent-' || left(v_no_consent::text, 8) || '@example.test', 'active', 'frontdesk', v_location);
  insert into public.salon_customer_consents (studio_id, salon_customer_id, consent_key, channel, status, source, text_version, actor_id, actor_role, location_id) values
    (v_studio, v_eligible, 'email_marketing', 'email', 'granted', 'system', 'uat-v1', v_owner, 'owner', v_location),
    (v_studio, v_suppressed, 'email_marketing', 'email', 'granted', 'system', 'uat-v1', v_owner, 'owner', v_location);
  insert into public.marketing_suppressions (studio_id, email, salon_customer_id, reason)
    select v_studio, lower(email), v_suppressed, 'manual' from public.salon_customers where id = v_suppressed;
  insert into public.pos_sales (id, studio_id, location_id, salon_customer_id, cashier_user_id, status, subtotal_amount, total_amount, paid_at) values
    (gen_random_uuid(), v_studio, v_location, v_eligible, v_owner, 'paid', 1500, 1500, now()),
    (gen_random_uuid(), v_studio, v_location, v_suppressed, v_owner, 'paid', 1500, 1500, now()),
    (gen_random_uuid(), v_studio, v_location, v_no_consent, v_owner, 'paid', 1500, 1500, now());
end $$;
