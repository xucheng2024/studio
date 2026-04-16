-- P1: only users with public.users.role = 'owner' may create/update/delete their studio rows

drop policy if exists "studios_owner_write" on public.studios;

create policy "studios_owner_write" on public.studios
  for all
  using (
    auth.uid() = owner_id
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'owner'
    )
  )
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'owner'
    )
  );
