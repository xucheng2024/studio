"use client";

import { useRouter, usePathname } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  // After sign-out, stay on the current studio page if possible.
  // Strip any /me/* or /auth/* sub-paths so we land on the public studio root.
  const redirectTo = (() => {
    const studioMatch = pathname.match(/^\/([a-z0-9-]+)(?:\/|$)/i);
    if (studioMatch) return `/${studioMatch[1]}`;
    return "/";
  })();

  return (
    <button
      type="button"
      className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      onClick={async () => {
        const supabase = createBrowserSupabase();
        await supabase.auth.signOut();
        router.replace(redirectTo);
        throttledRefresh(router);
      }}
    >
      Sign out
    </button>
  );
}
