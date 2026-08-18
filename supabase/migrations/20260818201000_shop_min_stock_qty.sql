-- Optional restock level for the Shop dashboard list. Not an inventory module.

alter table public.shop_products
  add column if not exists min_stock_qty integer
  check (min_stock_qty is null or min_stock_qty >= 0);
