-- Add extra images array to shop products (primary image_url stays as the listing cover).
alter table shop_products
  add column if not exists image_urls text[] not null default '{}';
