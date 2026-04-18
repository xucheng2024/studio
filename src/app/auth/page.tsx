import { Suspense } from "react";
import { AuthPageInner } from "./AuthPageInner";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[40vh] items-center justify-center p-8 text-stone-500">
          Loading…
        </main>
      }
    >
      <AuthPageInner />
    </Suspense>
  );
}
