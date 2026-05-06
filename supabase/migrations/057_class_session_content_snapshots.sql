alter table public.class_sessions
add column if not exists class_title_snapshot text,
add column if not exists class_description_snapshot text,
add column if not exists class_image_url_snapshot text;

update public.class_sessions cs
set
  class_title_snapshot = c.title,
  class_description_snapshot = c.description,
  class_image_url_snapshot = c.image_url
from public.classes c
where c.id = cs.class_id
  and (
    cs.class_title_snapshot is null
    or cs.class_description_snapshot is null
    or cs.class_image_url_snapshot is null
  );
