import { PageLoadingFallback } from "@/components/PageLoadingFallback";

export default function AppLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6 lg:px-8">
      <div className="mb-6 space-y-3">
        <div className="h-7 w-2/3 animate-pulse rounded-lg bg-stone-200/80 dark:bg-stone-800/80" />
        <div className="h-4 w-full animate-pulse rounded bg-stone-200/70 dark:bg-stone-800/70" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-44 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
        <div className="h-44 animate-pulse rounded-2xl bg-stone-200/80 dark:bg-stone-800/80" />
      </div>
      <PageLoadingFallback />
    </main>
  );
}
