export default function ServiceDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:px-8">
      <div className="h-5 w-32 animate-pulse rounded bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-6 aspect-video w-full animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-6 h-8 w-3/4 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-800/80" />
      <div className="mt-2 h-4 w-full animate-pulse rounded bg-stone-200/70 dark:bg-stone-800/70" />
      <div className="mt-8 h-28 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
    </main>
  );
}
