do $$
declare
  events_regclass regclass;
begin
  events_regclass := to_regclass('public.events');
  if events_regclass is not null and exists (
    select 1
    from pg_constraint
    where conname = 'events_price_check'
      and conrelid = events_regclass
  ) then
    alter table public.events drop constraint events_price_check;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.events') is not null then
    alter table public.events
    add constraint events_price_check
    check (price is null or price >= 0::numeric);
  end if;
end
$$;

do $$
declare
  shop_products_regclass regclass;
begin
  shop_products_regclass := to_regclass('public.shop_products');
  if shop_products_regclass is not null and exists (
    select 1
    from pg_constraint
    where conname = 'shop_products_price_check'
      and conrelid = shop_products_regclass
  ) then
    alter table public.shop_products drop constraint shop_products_price_check;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.shop_products') is not null then
    alter table public.shop_products
    add constraint shop_products_price_check
    check (price >= 0::numeric);
  end if;
end
$$;
