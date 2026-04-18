-- Remove legacy drop-in package model.
-- Session-level pricing is now handled by class_sessions.guest_price / credits_required.

-- Safety: if old data exists, keep it queryable but disable as sellable package first.
update public.packages
set is_active = false
where is_drop_in = true;

-- Normalize legacy type if needed.
update public.packages
set type = 'class_pack'
where type = 'single';

-- Remove legacy column after runtime code no longer depends on it.
alter table public.packages
  drop column if exists is_drop_in;
