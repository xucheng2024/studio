import { Suspense } from "react";
import { resolveStudioSlugFromCurrentHost } from "@/lib/member-auth.server";
import { AuthPageInner } from "./AuthPageInner";

export default async function AuthPage() {
  const memberStudioSlug = await resolveStudioSlugFromCurrentHost();
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
      <AuthPageInner
        memberStudioSlug={memberStudioSlug}
        memberHomePath={memberStudioSlug ? "/" : null}
        memberClassesPath={memberStudioSlug ? "/classes" : null}
      />
    </Suspense>
  );
}
