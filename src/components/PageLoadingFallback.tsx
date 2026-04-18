/** Shared full-width loading state for App Router `loading.tsx` segments. */
export function PageLoadingFallback() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 pb-12" aria-busy="true" aria-label="Loading">
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-stone-200 border-t-teal-600 dark:border-stone-700 dark:border-t-teal-400"
        role="presentation"
      />
      <p className="text-sm text-stone-500 dark:text-stone-400">Loading…</p>
    </div>
  );
}
