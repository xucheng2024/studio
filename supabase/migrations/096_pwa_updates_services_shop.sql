alter table public.studio_content_updates
  drop constraint if exists studio_content_updates_section_check;

alter table public.studio_content_updates
  add constraint studio_content_updates_section_check
  check (section in ('services', 'classes', 'events', 'packages', 'member-zone', 'shop'));
