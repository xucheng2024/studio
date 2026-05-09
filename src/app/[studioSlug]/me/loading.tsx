export default function StudioMemberLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-full bg-stone-200 dark:bg-stone-800" />
        <div className="h-4 w-64 rounded-full bg-stone-200 dark:bg-stone-800" />
        <div className="space-y-3 pt-4">
          <div className="h-28 rounded-2xl bg-stone-200 dark:bg-stone-800" />
          <div className="h-28 rounded-2xl bg-stone-200 dark:bg-stone-800" />
          <div className="h-28 rounded-2xl bg-stone-200 dark:bg-stone-800" />
        </div>
      </div>
    </main>
  );
}
