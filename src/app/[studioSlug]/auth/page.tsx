import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPageInner } from "@/app/(app)/auth/AuthPageInner";
import { studioClassesPath, studioHomePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type Props = {
  params: Promise<{ studioSlug: string }>;
};

export default async function MemberScopedAuthPage({ params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug ?? "");
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
        memberStudioSlug={studioSlug}
        memberHomePath={studioSlug ? studioHomePath(studioSlug) : "/"}
        memberClassesPath={studioSlug ? studioClassesPath(studioSlug) : "/"}
      />
    </Suspense>
  );
}
