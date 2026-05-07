import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ShoppingBag, RefreshCw, LayoutDashboard } from "lucide-react";
import { site } from "@/lib/brand";
import { ui } from "@/lib/ui";

type Props = {
  searchParams: Promise<{
    code?: string;
    next?: string;
    error?: string;
    error_description?: string;
  }>;
};

export default async function Home({ searchParams }: Props) {
  const sp = await searchParams;
  const hasOAuthParams = Boolean(sp.code || sp.error || sp.error_description);
  if (hasOAuthParams) {
    const params = new URLSearchParams();
    if (sp.code) params.set("code", sp.code);
    if (sp.error) params.set("error", sp.error);
    if (sp.error_description) params.set("error_description", sp.error_description);
    if (sp.next && sp.next.startsWith("/")) {
      params.set("next", sp.next);
    }
    const query = params.toString();
    redirect(query ? `/auth/callback?${query}` : "/auth/callback");
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <p className={ui.badge}>{site.badge}</p>
        <h1 className={`${ui.h1} mt-3`}>{site.homeHeadline}</h1>
        <p className={`${ui.lead} mt-4 max-w-lg`}>{site.homeLead}</p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <Link
            href="/booking"
            className={`${ui.cardInteractive} group flex gap-4 border-teal-200/60 dark:border-teal-900/50`}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 transition-colors group-hover:bg-teal-200 dark:bg-teal-900/50 dark:text-teal-400 dark:group-hover:bg-teal-900">
              <CalendarDays size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Book a class</span>
              <span className={`text-xs ${ui.muted}`}>Pick a slot, pay online — seat held instantly</span>
            </span>
          </Link>

          <Link href="/checkout" className={`${ui.cardInteractive} group flex gap-4`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 transition-colors group-hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-400 dark:group-hover:bg-violet-900/60">
              <ShoppingBag size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Buy a class pack</span>
              <span className={`text-xs ${ui.muted}`}>Class passes ready when you are — book any class in seconds</span>
            </span>
          </Link>

          <Link href="/booking" className={`${ui.cardInteractive} group flex gap-4`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 transition-colors group-hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400 dark:group-hover:bg-emerald-900/60">
              <RefreshCw size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Use your studio booking page</span>
              <span className={`text-xs ${ui.muted}`}>
                Members sign in from a studio booking link, where bookings, payments, and class passes stay in one place
              </span>
            </span>
          </Link>

          <Link href="/dashboard" className={`${ui.cardInteractive} group flex gap-4`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition-colors group-hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:bg-stone-700">
              <LayoutDashboard size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Studio dashboard</span>
              <span className={`text-xs ${ui.muted}`}>Pending payments, today&apos;s arrivals, records &amp; invoices</span>
            </span>
          </Link>
        </div>

        <p className={`mt-10 text-sm ${ui.muted}`}>
          Studios get a shareable booking link at{" "}
          <code className={ui.code}>/booking/your-slug</code>{" "}
          for members to book classes online.{" "}
          <Link href="/booking" className={ui.link}>Open booking →</Link>
        </p>
      </div>
    </main>
  );
}
