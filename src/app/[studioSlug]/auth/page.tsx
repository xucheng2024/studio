import { Suspense } from "react";
import { AuthPageInner } from "@/app/auth/AuthPageInner";

export default function MemberScopedAuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
            <p className="text-sm text-stone-400">Loading…</p>
          </div>
        </main>
      }
    >
      <AuthPageInner />
    </Suspense>
  );
}
