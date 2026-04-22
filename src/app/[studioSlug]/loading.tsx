import { ui } from "@/lib/ui";

export default function PublicStudioLoading() {
  return (
    <main className={ui.page}>
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="aspect-video w-full animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-800" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
        <div className="h-4 w-full animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
      </div>
    </main>
  );
}
