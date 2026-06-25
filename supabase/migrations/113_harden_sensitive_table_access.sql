alter table public.member_studio_memberships enable row level security;
alter table public.operation_audits enable row level security;
alter table public.platform_owner_grants enable row level security;
alter table public.staff_invites enable row level security;
alter table public.guest_merge_audits enable row level security;
alter table public.auth_access_anomalies enable row level security;
alter table public.pwa_push_subscriptions enable row level security;

revoke all on table public.member_studio_memberships from public;
revoke all on table public.member_studio_memberships from anon;
revoke all on table public.member_studio_memberships from authenticated;
grant all on table public.member_studio_memberships to service_role;

revoke all on table public.operation_audits from public;
revoke all on table public.operation_audits from anon;
revoke all on table public.operation_audits from authenticated;
grant all on table public.operation_audits to service_role;

revoke all on table public.platform_owner_grants from public;
revoke all on table public.platform_owner_grants from anon;
revoke all on table public.platform_owner_grants from authenticated;
grant all on table public.platform_owner_grants to service_role;

revoke all on table public.staff_invites from public;
revoke all on table public.staff_invites from anon;
revoke all on table public.staff_invites from authenticated;
grant all on table public.staff_invites to service_role;

revoke all on table public.guest_merge_audits from public;
revoke all on table public.guest_merge_audits from anon;
revoke all on table public.guest_merge_audits from authenticated;
grant all on table public.guest_merge_audits to service_role;

revoke all on table public.auth_access_anomalies from public;
revoke all on table public.auth_access_anomalies from anon;
revoke all on table public.auth_access_anomalies from authenticated;
grant all on table public.auth_access_anomalies to service_role;

revoke all on sequence public.auth_access_anomalies_id_seq from public;
revoke all on sequence public.auth_access_anomalies_id_seq from anon;
revoke all on sequence public.auth_access_anomalies_id_seq from authenticated;
grant all on sequence public.auth_access_anomalies_id_seq to service_role;

revoke all on table public.pwa_push_subscriptions from public;
revoke all on table public.pwa_push_subscriptions from anon;
revoke all on table public.pwa_push_subscriptions from authenticated;
grant all on table public.pwa_push_subscriptions to service_role;

alter default privileges for role postgres in schema public revoke all on tables from public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on tables to service_role;
