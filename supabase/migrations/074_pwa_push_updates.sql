create table if not exists studio_content_updates (
  studio_id uuid not null references studios(id) on delete cascade,
  section text not null check (section in ('classes', 'events', 'packages', 'member-zone')),
  updated_at timestamptz not null default now(),
  primary key (studio_id, section)
);

create table if not exists pwa_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, endpoint)
);

create index if not exists pwa_push_subscriptions_studio_idx
  on pwa_push_subscriptions (studio_id);
