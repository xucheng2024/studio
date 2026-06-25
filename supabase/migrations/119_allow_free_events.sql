alter table public.events
drop constraint if exists events_price_check;

alter table public.events
add constraint events_price_check check (price >= 0);
