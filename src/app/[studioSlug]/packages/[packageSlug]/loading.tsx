import { ui } from "@/lib/ui";

export default function PackageShareLoading() {
  return (
    <main className={ui.page}>
      <div className="max-w-2xl space-y-3">
        <div className="h-5 w-28 rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-9 w-4/5 max-w-md rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-6 w-40 rounded bg-stone-200 dark:bg-stone-700" />
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="h-5 w-28 rounded bg-stone-100 dark:bg-stone-800" />
          <div className="h-5 w-32 rounded bg-stone-100 dark:bg-stone-800" />
        </div>
      </div>
    </main>
  );
}
