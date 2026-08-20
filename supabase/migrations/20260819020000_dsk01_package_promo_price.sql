-- Optional "was" price for packages so a promotion/discount can be shown.
-- `price` stays the amount actually charged everywhere it is already read.

alter table public.packages
  add column if not exists original_price numeric(12,2);

alter table public.packages
  add constraint packages_original_price_above_price
  check (original_price is null or original_price > price);
