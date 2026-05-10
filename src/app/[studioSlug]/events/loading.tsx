export default function EventsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <div className="h-5 w-24 animate-pulse rounded bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-4 h-8 w-48 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-5 grid gap-4">
        <div className="h-56 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
        <div className="h-56 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
      </div>
    </main>
  );
}
