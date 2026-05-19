import Link from "next/link";
import { SiteHeaderConfigured } from "@/components/SiteHeaderClientNav";
import { site } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ui } from "@/lib/ui";

export function SiteHeader() {
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

  return (
    <header className={ui.headerBar}>
      <SiteHeaderConfigured />
    </header>
  );
}
