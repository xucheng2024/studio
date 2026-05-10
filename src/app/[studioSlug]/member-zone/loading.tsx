export default function MemberZoneListLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <div className="h-5 w-32 animate-pulse rounded bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-4 h-8 w-44 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800/70" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
        <div className="h-72 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
      </div>
    </main>
  );
}
