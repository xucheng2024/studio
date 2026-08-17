\set ON_ERROR_STOP on

select set_config('mkt02_uat.studio_id', :'mkt02_uat_studio_id', false);
select set_config('mkt02_uat.location_id', :'mkt02_uat_location_id', false);
select set_config('mkt02_uat.customer_id', :'mkt02_uat_customer_id', false);
select set_config('mkt02_uat.campaign_id', :'mkt02_uat_campaign_id', false);
select set_config('mkt02_uat.recipient_id', :'mkt02_uat_recipient_id', false);
select set_config('mkt02_uat.provider_email_id', :'mkt02_uat_provider_email_id', false);

do $$
declare
  v_studio uuid := current_setting('mkt02_uat.studio_id')::uuid;
  v_location uuid := current_setting('mkt02_uat.location_id')::uuid;
  v_owner uuid := 'a2000000-0000-4000-8000-000000000201';
  v_instructor uuid := 'a2000000-0000-4000-8000-000000000202';
  v_customer uuid := current_setting('mkt02_uat.customer_id')::uuid;
  v_campaign uuid := current_setting('mkt02_uat.campaign_id')::uuid;
  v_recipient uuid := current_setting('mkt02_uat.recipient_id')::uuid;
  v_provider_email_id text := current_setting('mkt02_uat.provider_email_id');
begin
  if exists (
    select 1 from (values
      (v_owner, 'mkt02-local-owner@example.test'), (v_instructor, 'mkt02-local-instructor@example.test')
    ) expected(id, email)
    where not exists (select 1 from auth.users where id = expected.id and lower(email) = expected.email)
       or exists (select 1 from auth.users where lower(email) = expected.email and id <> expected.id)
  ) then raise exception 'MKT-02 local fixture requires exact local Auth identities'; end if;

  insert into public.users (id, email) values
    (v_owner, 'mkt02-local-owner@example.test'), (v_instructor, 'mkt02-local-instructor@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.user_profiles (id, email, full_name, role) values
    (v_owner, 'mkt02-local-owner@example.test', 'MKT-02 local owner', 'member'),
    (v_instructor, 'mkt02-local-instructor@example.test', 'MKT-02 local instructor', 'member')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  insert into public.studios (id, owner_id, name, public_slug, contract_status, resend_enabled)
    values (v_studio, v_owner, 'MKT-02 email UAT', 'mkt02-email-' || left(v_studio::text, 8), 'active', false);
  insert into public.locations (id, studio_id, name, is_active)
    values (v_location, v_studio, 'MKT-02 Email', true);
  insert into public.staff_memberships (id, user_id, studio_id, location_id, role, is_active)
    values (gen_random_uuid(), v_instructor, v_studio, v_location, 'instructor', true);

  insert into public.salon_customers (id, studio_id, full_name, email, status, source, preferred_location_id)
    values (v_customer, v_studio, 'MKT-02 webhook customer', 'mkt02-webhook-' || left(v_customer::text, 8) || '@example.test', 'active', 'frontdesk', v_location);
  insert into public.marketing_campaigns (
    id, studio_id, location_id, name, audience_type, audience_rules, subject, body, status, created_by
  ) values (
    v_campaign, v_studio, v_location, 'MKT-02 studio email webhook', 'vip', '{}'::jsonb, 'MKT-02 subject', 'MKT-02 body', 'sending', v_owner
  );
  insert into public.marketing_campaign_recipients (
    id, campaign_id, studio_id, salon_customer_id, email_snapshot, full_name_snapshot, eligibility, dispatch_status, provider_email_id, submitted_at
  ) values (
    v_recipient, v_campaign, v_studio, v_customer,
    'mkt02-webhook-' || left(v_customer::text, 8) || '@example.test',
    'MKT-02 webhook customer', 'eligible', 'submitted', v_provider_email_id, now()
  );
end $$;
