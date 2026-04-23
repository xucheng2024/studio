import Link from "next/link";
import { site } from "@/lib/brand";
import { SignOutButton } from "@/components/SignOutButton";
import { MobileMenu } from "@/components/MobileMenu";
import { resolveAccessContext } from "@/lib/rbac";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
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
            <Link href="/booking" className={ui.linkHeaderNav}>Classes</Link>
            <Link href="/member/auth" className={`${ui.btnPrimarySm} py-1!`}>Sign in</Link>
          </nav>
        </div>
      </header>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let showDashboard = false;
  if (user) {
    const access = await resolveAccessContext({ userId: user.id, email: user.email });
    showDashboard = access.hasBackofficeAccess;
  }
  const userInitial =
    user?.email?.trim().charAt(0).toUpperCase() ||
    user?.id?.charAt(0).toUpperCase() ||
    "U";

  const navItems = user
    ? [
        { href: "/booking", label: "Classes" },
        { href: "/me/bookings", label: "My bookings" },
        ...(showDashboard ? [{ href: "/dashboard", label: "Dashboard" }] : []),
      ]
    : [{ href: "/booking", label: "Classes" }];

  return (
    <header className={ui.headerBar}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className={ui.linkHeaderBrand}>
          {site.name}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 sm:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={ui.linkHeaderNav}>
              {item.label}
            </Link>
          ))}
          {user ? (
            <details className="relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-stone-100 dark:hover:bg-stone-800">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
                  {userInitial}
                </span>
                <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                  Account
                </span>
              </summary>
              <div className="absolute right-0 top-11 z-50 min-w-44 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href} className={ui.linkHeaderMenu}>
                    {item.label}
                  </Link>
                ))}
                <div className={`mt-1 border-t ${ui.divider} pt-1`}>
                  <SignOutButton />
                </div>
              </div>
            </details>
          ) : (
            <Link href="/member/auth" className={`${ui.btnPrimarySm} ml-1 py-1!`}>
              Sign in
            </Link>
          )}
        </nav>

        {/* Mobile nav trigger */}
        <div className="flex items-center gap-2 sm:hidden">
          {user && (
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">
              {userInitial}
            </span>
          )}
          <MobileMenu
            navItems={navItems}
            isLoggedIn={Boolean(user)}
          />
        </div>
      </div>
    </header>
  );
}
