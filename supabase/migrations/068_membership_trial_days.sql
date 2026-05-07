alter table public.membership_products
add column if not exists trial_days int not null default 0;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'membership_products_trial_days_check'
      and conrelid = 'public.membership_products'::regclass
  ) then
    alter table public.membership_products drop constraint membership_products_trial_days_check;
  end if;
end $$;

alter table public.membership_products
add constraint membership_products_trial_days_check
check (trial_days >= 0 and trial_days <= 60);

