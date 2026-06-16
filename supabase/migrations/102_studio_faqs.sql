do $$
begin
  if to_regclass('public.studios') is not null and to_regclass('public.studio_faqs') is null then
    create table public.studio_faqs (
      id uuid primary key default gen_random_uuid(),
      studio_id uuid not null references public.studios(id) on delete cascade,
      question text not null,
      answer text not null,
      sort_order integer not null default 100,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint studio_faqs_question_nonempty check (char_length(btrim(question)) > 0),
      constraint studio_faqs_answer_nonempty check (char_length(btrim(answer)) > 0)
    );
  end if;
end
$$;

create index if not exists idx_studio_faqs_studio_sort
on public.studio_faqs using btree (studio_id, sort_order, created_at);
