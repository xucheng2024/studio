-- Events can be published without a visible ticket price.
alter table public.events
  alter column price drop not null;
