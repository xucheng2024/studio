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
              <span className={`text-xs ${ui.muted}`}>Real-time seats, clear rules, verified payment flow</span>
            </span>
          </Link>

          <Link href="/checkout" className={`${ui.cardInteractive} group flex gap-4`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 transition-colors group-hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-400 dark:group-hover:bg-violet-900/60">
              <ShoppingBag size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Buy a class pack</span>
              <span className={`text-xs ${ui.muted}`}>Top up credits, book faster, full usage history in one account</span>
            </span>
          </Link>

          {/* Non-interactive tile — visually muted to signal it's not a link */}
          <div className="flex gap-4 rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 p-4 dark:border-stone-700 dark:bg-stone-900/30">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
              <RefreshCw size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-600 dark:text-stone-400">Keep member history synced</span>
              <span className={`text-xs ${ui.muted}`}>
                Sign in with your guest email to merge bookings, payments, and credits into one timeline
              </span>
            </span>
          </div>

          <Link href="/dashboard" className={`${ui.cardInteractive} group flex gap-4`}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition-colors group-hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:bg-stone-700">
              <LayoutDashboard size={19} />
            </span>
            <span className="flex flex-col justify-center gap-0.5">
              <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">Operations workspace</span>
              <span className={`text-xs ${ui.muted}`}>Daily desk view, payment records, invoices, multi-location tools</span>
            </span>
          </Link>
        </div>

        <p className={`mt-10 text-sm ${ui.muted}`}>
          Each studio can share one booking URL like{" "}
          <code className={ui.code}>/booking/your-slug</code> — print the QR from the dashboard.
          {` ${site.marketing.paymentFlowNote} ${site.marketing.mergeNote}`}
          Need access?{" "}
          <Link href="/auth" className={ui.link}>
            Sign in
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
