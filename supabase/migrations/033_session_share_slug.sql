-- Per-session share slug: lets each class_session carry its own public link slug,
-- independent of the parent class's share_slug. This prevents session-link generation
-- from accidentally overwriting or being overwritten by the class-level slug.

alter table public.class_sessions
  add column if not exists share_slug text;

alter table public.class_sessions
  drop constraint if exists class_sessions_share_slug_format;

alter table public.class_sessions
  add constraint class_sessions_share_slug_format check (
    share_slug is null or share_slug ~ '^[a-z0-9-]{6,80}$'
  );

-- Unique per class (which implicitly scopes to a studio). This allows different
-- studios – or different classes within the same studio – to reuse the same slug
-- independently. Null slugs never conflict with each other.
drop index if exists idx_class_sessions_share_slug;

create unique index idx_class_sessions_share_slug
  on public.class_sessions (class_id, share_slug)
  where share_slug is not null;
