\set ON_ERROR_STOP on

-- Deterministic IDs for repeatable concurrency checks.
insert into public.users (id, email) values
  ('91111111-1111-1111-1111-111111111111', 'apt02-owner@example.com')
on conflict (id) do update set email = excluded.email;

insert into public.studios (id, contract_status) values
  ('11111111-1111-1111-1111-111111111111', 'active')
on conflict (id) do update set contract_status = excluded.contract_status;

insert into public.locations (id, studio_id, name, is_active) values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'APT02-Concurrency-L1', true)
on conflict (id) do update set name = excluded.name, is_active = excluded.is_active;

insert into public.studio_services (id, studio_id, name, price, currency, is_active) values
  ('31111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'APT02-Concurrency-Service', 120, 'SGD', true)
on conflict (id) do update set name = excluded.name, price = excluded.price, currency = excluded.currency, is_active = excluded.is_active;

insert into public.service_locations (studio_id, service_id, location_id, is_enabled, uses_default_values)
values ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', true, true)
on conflict (service_id, location_id) do update set is_enabled = true;

insert into public.salon_customers (id, studio_id, full_name, status, source)
values ('41111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'APT02 Concurrency Customer', 'active', 'frontdesk')
on conflict (id) do update set full_name = excluded.full_name, status = excluded.status;

insert into public.employees (id, studio_id, display_name, employment_status, is_active)
values
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'APT02-E1', 'active', true),
  ('52222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'APT02-E2', 'active', true)
on conflict (id) do update set display_name = excluded.display_name, employment_status = excluded.employment_status, is_active = excluded.is_active;

insert into public.employee_locations (employee_id, location_id, studio_id, is_active)
values
  ('51111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', true),
  ('52222222-2222-2222-2222-222222222222', '21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', true)
on conflict do nothing;

insert into public.service_employees (studio_id, service_id, employee_id, is_active)
values
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', true),
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', '52222222-2222-2222-2222-222222222222', true)
on conflict (service_id, employee_id) do update set is_active = true;

-- Monday operating/work hours in SGT (UTC+8)
insert into public.location_operating_hours (studio_id, location_id, weekday, is_closed, opens_at, closes_at)
values ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 1, false, '08:00', '21:00')
on conflict do nothing;

insert into public.employee_working_hours (studio_id, employee_id, location_id, weekday, starts_at, ends_at, is_active)
values
  ('11111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 1, '09:00', '18:00', true),
  ('11111111-1111-1111-1111-111111111111', '52222222-2222-2222-2222-222222222222', '21111111-1111-1111-1111-111111111111', 1, '09:00', '18:00', true)
on conflict do nothing;

insert into public.salon_resources (id, studio_id, location_id, name, resource_type, is_active, capacity)
values
  ('61111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'APT02-Room-1', 'room', true, 1),
  ('61222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'APT02-Bed-1', 'bed', true, 1),
  ('61333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'APT02-Room-2', 'room', true, 1),
  ('61444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'APT02-Bed-2', 'bed', true, 1)
on conflict (id) do update set is_active = true, capacity = excluded.capacity;

insert into public.service_resource_requirements (studio_id, service_id, resource_type, required_quantity)
values
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'room', 1),
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'bed', 1)
on conflict (service_id, resource_type) do update set required_quantity = excluded.required_quantity;
