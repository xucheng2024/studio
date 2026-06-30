import { cookies } from "next/headers";
import Link from "next/link";
import { SiteHeaderConfigured } from "@/components/SiteHeaderClientNav";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { normalizeStudioSlug } from "@/lib/slug";
import { site } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ui } from "@/lib/ui";

export async function SiteHeader() {
  if (!isSupabaseConfigured()) {
    return (
      <header className={ui.headerBar}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className={ui.linkHeaderBrand}>
            {site.name}
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/" className={ui.linkHeaderNav}>Studios</Link>
            <Link href="/auth" className={`${ui.btnPrimarySm} py-1!`}>Sign in</Link>
          </nav>
        </div>
      </header>
    );
  }

  const cookieStore = await cookies();
  const initialStudioSlug =
    normalizeStudioSlug(cookieStore.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "") ?? "";

  return (
    <header className={ui.headerBar}>
      <SiteHeaderConfigured initialStudioSlug={initialStudioSlug} />
    </header>
  );
}
