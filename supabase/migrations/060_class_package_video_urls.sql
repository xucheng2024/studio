-- Add video support for class templates and packages, and include it in session snapshots.

alter table public.classes
add column if not exists video_url text;

alter table public.packages
add column if not exists video_url text;

alter table public.class_sessions
add column if not exists class_video_url_snapshot text;

-- Backfill snapshots for existing sessions.
update public.class_sessions cs
set class_video_url_snapshot = c.video_url
from public.classes c
where c.id = cs.class_id
  and cs.class_video_url_snapshot is null;

