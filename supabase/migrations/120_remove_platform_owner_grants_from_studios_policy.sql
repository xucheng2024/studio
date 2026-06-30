drop policy if exists studios_owner_write on public.studios;

create policy studios_owner_write
on public.studios
for all
using (
  auth.uid() = owner_id
  or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = auth.uid()
      and sm.studio_id = studios.id
      and sm.role = 'owner'
      and sm.is_active = true
  )
)
with check (
  auth.uid() = owner_id
  or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = auth.uid()
      and sm.studio_id = studios.id
      and sm.role = 'owner'
      and sm.is_active = true
  )
);
