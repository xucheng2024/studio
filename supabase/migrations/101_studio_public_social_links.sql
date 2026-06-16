do $$
begin
  if to_regclass('public.studios') is not null then
    alter table public.studios
      add column if not exists public_instagram_url text,
      add column if not exists public_linkedin_url text,
      add column if not exists public_facebook_url text,
      add column if not exists public_tiktok_url text,
      add column if not exists public_youtube_url text,
      add column if not exists public_x_url text,
      add column if not exists public_contact_email text;
  end if;
end
$$;
