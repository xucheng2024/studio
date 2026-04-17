import Link from "next/link";
import { site } from "@/lib/brand";
import { SignOutButton } from "@/components/SignOutButton";
import { resolveAccessContext } from "@/lib/rbac";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

export async function SiteHeader() {
  if (!isSupabaseConfigured()) {
    return (
      <header className={ui.headerBar}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100"
          >
            {site.name}
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1 sm:gap-x-3">
            <Link
              href="/booking"
              className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Classes
            </Link>
            <Link
              href="/auth"
              className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Sign in / Create account
            </Link>
          </nav>
        </div>
      </header>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let showDashboard = false;
  if (user) {
    const access = await resolveAccessContext({ userId: user.id, email: user.email });
    showDashboard = access.hasBackofficeAccess;
  }
  const userInitial =
    user?.email?.trim().charAt(0).toUpperCase() ||
    user?.id?.charAt(0).toUpperCase() ||
    "U";

  return (
    <header className={ui.headerBar}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100"
        >
          {site.name}
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1 sm:gap-x-3">
          <Link
            href="/booking"
            className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Classes
          </Link>
          {user ? (
            <>
              <Link
                href="/me/bookings"
                className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                My bookings
              </Link>
              {showDashboard ? (
                <Link
                  href="/dashboard"
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                >
                  Dashboard
                </Link>
              ) : null}
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-900 dark:bg-teal-900/60 dark:text-teal-100">
                    {userInitial}
                  </span>
                  <span className="hidden sm:inline">Account</span>
                </summary>
                <div className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-900/10 max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-16 max-sm:w-auto dark:border-stone-800 dark:bg-stone-900">
                  <Link
                    href="/me/bookings"
                    className="block rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                  >
                    My bookings
                  </Link>
                  {showDashboard ? (
                    <Link
                      href="/dashboard"
                      className="block rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                    >
                      Dashboard
                    </Link>
                  ) : null}
                  <SignOutButton />
                </div>
              </details>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-md px-2 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Sign in / Create account
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
