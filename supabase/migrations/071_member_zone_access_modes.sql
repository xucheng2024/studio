update public.member_zone_series
set access_type = case
  when access_type = 'members_only' then 'member_only'
  when access_type = 'paid' then 'member_or_paid'
  else access_type
end
where access_type in ('members_only', 'paid');

update public.member_zone_lessons
set access_override = case
  when access_override = 'members_only' then 'member_only'
  when access_override = 'paid' then 'member_or_paid'
  else access_override
end
where access_override in ('members_only', 'paid');

alter table public.member_zone_series
  drop constraint if exists member_zone_series_access_type_check;

alter table public.member_zone_series
  add constraint member_zone_series_access_type_check
  check (
    access_type = any (
      array[
        'free'::text,
        'paid_only'::text,
        'member_only'::text,
        'member_or_paid'::text
      ]
    )
  );

alter table public.member_zone_lessons
  drop constraint if exists member_zone_lessons_access_override_check;

alter table public.member_zone_lessons
  add constraint member_zone_lessons_access_override_check
  check (
    access_override = any (
      array[
        'inherit'::text,
        'free'::text,
        'paid_only'::text,
        'member_only'::text,
        'member_or_paid'::text
      ]
    )
  );
