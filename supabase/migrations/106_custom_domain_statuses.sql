alter table public.studios
  add column if not exists custom_domain_kind text,
  add column if not exists custom_domain_status text,
  add column if not exists custom_domain_vercel_status text,
  add column if not exists custom_domain_dns_status text,
  add column if not exists custom_domain_ssl_status text,
  add column if not exists custom_domain_last_verified_at timestamptz,
  add column if not exists custom_domain_last_error text;

update public.studios
set
  custom_domain_kind = case
    when custom_domain is null then null
    when array_length(regexp_split_to_array(custom_domain, '\.'), 1) = 2 then 'apex'
    else 'subdomain'
  end,
  custom_domain_status = case
    when custom_domain is null then 'not_configured'
    else coalesce(custom_domain_status, 'pending')
  end,
  custom_domain_vercel_status = case
    when custom_domain is null then 'not_configured'
    else coalesce(custom_domain_vercel_status, 'unknown')
  end,
  custom_domain_dns_status = case
    when custom_domain is null then 'not_configured'
    else coalesce(custom_domain_dns_status, 'pending')
  end,
  custom_domain_ssl_status = case
    when custom_domain is null then 'not_configured'
    else coalesce(custom_domain_ssl_status, 'pending')
  end,
  custom_domain_last_error = case
    when custom_domain is null then null
    else custom_domain_last_error
  end
where
  custom_domain_kind is null
  or custom_domain_status is null
  or custom_domain_vercel_status is null
  or custom_domain_dns_status is null
  or custom_domain_ssl_status is null;

alter table public.studios
  add constraint studios_custom_domain_kind_check
    check (custom_domain_kind is null or custom_domain_kind in ('subdomain', 'apex'));

alter table public.studios
  add constraint studios_custom_domain_status_check
    check (custom_domain_status is null or custom_domain_status in ('not_configured', 'pending', 'misconfigured', 'active'));

alter table public.studios
  add constraint studios_custom_domain_vercel_status_check
    check (custom_domain_vercel_status is null or custom_domain_vercel_status in ('not_configured', 'registered', 'failed', 'unknown'));

alter table public.studios
  add constraint studios_custom_domain_dns_status_check
    check (custom_domain_dns_status is null or custom_domain_dns_status in ('not_configured', 'verified', 'pending', 'misconfigured', 'unknown'));

alter table public.studios
  add constraint studios_custom_domain_ssl_status_check
    check (custom_domain_ssl_status is null or custom_domain_ssl_status in ('not_configured', 'ready', 'pending', 'unknown'));
