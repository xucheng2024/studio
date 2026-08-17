\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_studio uuid := gen_random_uuid();
  v_location uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_campaign uuid;
  v_snapshot jsonb;
  v_schedule jsonb;
  v_claim record;
  v_claim_again integer;
  v_retry record;
  v_complete jsonb;
  v_event jsonb;
  v_link_token uuid;
  v_click jsonb;
  v_uncertain_campaign uuid;
  v_uncertain_recipient uuid;
  v_manual_retry jsonb;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'authenticated', 'authenticated', 'mkt02-owner-' || left(v_owner::text, 8) || '@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.users (id, email) values (v_owner, 'mkt02-owner-' || left(v_owner::text, 8) || '@example.test');
  insert into public.user_profiles (id, email, full_name, role)
  values (v_owner, 'mkt02-owner-' || left(v_owner::text, 8) || '@example.test', 'MKT-02 owner', 'member');
  insert into public.studios (id, owner_id, name, public_slug, contract_status)
  values (v_studio, v_owner, 'MKT-02 verify', 'mkt02-' || left(v_studio::text, 8), 'active');
  insert into public.locations (id, studio_id, name, is_active) values (v_location, v_studio, 'MKT-02 location', true);
  insert into public.salon_customers (id, studio_id, full_name, email, status, source, preferred_location_id)
  values (v_customer, v_studio, 'MKT-02 recipient', 'mkt02-' || left(v_customer::text, 8) || '@example.test', 'active', 'frontdesk', v_location);
  insert into public.salon_customer_consents (studio_id, salon_customer_id, consent_key, channel, status, source, text_version, actor_id, actor_role, location_id)
  values (v_studio, v_customer, 'email_marketing', 'email', 'granted', 'system', 'mkt02-v1', v_owner, 'owner', v_location);
  insert into public.pos_sales (id, studio_id, location_id, salon_customer_id, cashier_user_id, status, subtotal_amount, total_amount, paid_at)
  values (gen_random_uuid(), v_studio, v_location, v_customer, v_owner, 'paid', 1500, 1500, now());

  v_snapshot := public.mkt01_create_campaign_snapshot(v_owner, 'owner', v_studio, v_location, 'MKT-02 verify', 'vip', 1000, 3, 90, 'Subject', 'Body', null, 'Book', 'https://example.test/book');
  v_campaign := (v_snapshot->>'campaign_id')::uuid;
  if (v_snapshot->>'eligible_count')::integer <> 1 then raise exception 'fixture recipient was not eligible'; end if;

  v_schedule := public.mkt02_schedule_campaign(v_campaign, v_owner, 'owner', now());
  if not (v_schedule->>'ok')::boolean or (v_schedule->>'ready_count')::integer <> 1 then raise exception 'campaign schedule failed: %', v_schedule; end if;

  select * into v_claim from public.mkt02_claim_dispatch_batch(50, 300, 5);
  if v_claim.recipient_id is null or v_claim.dispatch_batch_id is null then raise exception 'dispatch claim failed'; end if;
  select count(*) into v_claim_again from public.mkt02_claim_dispatch_batch(50, 300, 5);
  if v_claim_again <> 0 then raise exception 'duplicate cron claimed an in-progress recipient'; end if;

  perform public.mkt02_fail_dispatch_batch(array[v_claim.recipient_id], v_claim.claim_token, 'temporary', true, 5);
  update public.marketing_campaign_recipients set next_attempt_at = now() where id = v_claim.recipient_id;
  select * into v_retry from public.mkt02_claim_dispatch_batch(50, 300, 5);
  if v_retry.recipient_id <> v_claim.recipient_id or v_retry.attempt_count <> 2 then raise exception 'retry claim failed'; end if;
  v_complete := public.mkt02_complete_dispatch_batch(array[v_retry.recipient_id], array['resend-mkt02-test'], v_retry.claim_token);
  if not (v_complete->>'ok')::boolean then raise exception 'dispatch completion failed: %', v_complete; end if;

  v_event := public.mkt02_apply_resend_event('evt-delivered', 'resend-mkt02-test', 'delivered', now(), '{}'::jsonb);
  if not (v_event->>'ok')::boolean then raise exception 'delivery event failed'; end if;
  if (select dispatch_status from public.marketing_campaign_recipients where id = v_retry.recipient_id) <> 'delivered' then raise exception 'delivery status not reported'; end if;

  select token into v_link_token from public.marketing_links where recipient_id = v_retry.recipient_id;
  v_click := public.mkt02_record_click(v_link_token);
  if not (v_click->>'ok')::boolean or v_click->>'target_url' <> 'https://example.test/book' then raise exception 'click tracking failed'; end if;
  if (select first_clicked_at is null from public.marketing_campaign_recipients where id = v_retry.recipient_id) then raise exception 'unique click not reported'; end if;

  perform public.mkt02_apply_resend_event('evt-bounced', 'resend-mkt02-test', 'bounced', now(), '{"reason":"hard bounce"}'::jsonb);
  if not exists (select 1 from public.marketing_suppressions where studio_id = v_studio and salon_customer_id = v_customer and reason = 'bounce') then raise exception 'bounce suppression missing'; end if;

  delete from public.marketing_suppressions where studio_id = v_studio and salon_customer_id = v_customer;
  v_snapshot := public.mkt01_create_campaign_snapshot(v_owner, 'owner', v_studio, v_location, 'MKT-02 uncertain', 'vip', 1000, 3, 90, 'Subject', 'Body', null, null, null);
  v_uncertain_campaign := (v_snapshot->>'campaign_id')::uuid;
  select id into v_uncertain_recipient from public.marketing_campaign_recipients where campaign_id = v_uncertain_campaign;
  update public.marketing_campaign_recipients
  set dispatch_status = 'failed', last_error = 'dispatch outcome could not be reconciled'
  where id = v_uncertain_recipient;
  v_manual_retry := public.mkt02_retry_campaign(v_uncertain_campaign, v_owner, 'owner');
  if (v_manual_retry->>'retry_count')::integer <> 0 then raise exception 'uncertain provider outcome was manually retried'; end if;
end $$;

rollback;

select 'mkt02_dispatch_ok' as result;
