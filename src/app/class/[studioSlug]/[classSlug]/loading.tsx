import { ui } from "@/lib/ui";

export default function ClassShareLoading() {
  return (
    <main className={ui.page}>
      <div className="mb-6 w-full overflow-hidden rounded-2xl bg-linear-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900">
        <div className="aspect-video w-full animate-pulse" aria-hidden="true" />
      </div>
      <div className="max-w-2xl space-y-3">
        <div className="h-5 w-24 rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-9 w-4/5 max-w-md rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-4 w-full rounded bg-stone-100 dark:bg-stone-800" />
        <div className="h-4 w-2/3 rounded bg-stone-100 dark:bg-stone-800" />
      </div>
      <div className="mt-10 h-8 w-48 rounded bg-stone-200 dark:bg-stone-700" />
      <ul className="mt-4 flex max-w-2xl flex-col gap-3">
        {[1, 2].map((i) => (
          <li key={i} className={`${ui.card} h-32 animate-pulse bg-stone-50 dark:bg-stone-900/40`} />
        ))}
      </ul>
    </main>
  );
}
