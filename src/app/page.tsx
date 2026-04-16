import Link from "next/link";
import { site } from "@/lib/brand";
import { ui } from "@/lib/ui";

export default function Home() {
  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <p className={ui.badge}>{site.badge}</p>
        <h1 className={`${ui.h1} mt-3`}>{site.homeHeadline}</h1>
        <p className={`${ui.lead} mt-4 max-w-lg`}>{site.homeLead}</p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <Link
            href="/booking"
            className={`${ui.cardInteractive} flex flex-col gap-1 border-teal-200/60 dark:border-teal-900/50`}
          >
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">
              Book a class
            </span>
            <span className={ui.muted}>See real-time seats, clear rules, and fast reservation flow</span>
          </Link>
          <Link href="/checkout" className={`${ui.cardInteractive} flex flex-col gap-1`}>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">
              Buy a class pack
            </span>
            <span className={ui.muted}>Top up credits and continue booking without frontdesk delays</span>
          </Link>
          <Link href="/auth?tab=member" className={`${ui.cardInteractive} flex flex-col gap-1`}>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">
              Keep client history synced
            </span>
            <span className={ui.muted}>
              Guests can continue with the same email and keep bookings, payments, and credits in one timeline
            </span>
          </Link>
          <Link href="/dashboard" className={`${ui.cardInteractive} flex flex-col gap-1`}>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-50">
              Owner workspace
            </span>
            <span className={ui.muted}>Run classes, payments, and attendance with fewer manual checks</span>
          </Link>
        </div>

        <p className={`mt-10 text-sm ${ui.muted}`}>
          Each studio can share one booking URL like{" "}
          <code className={ui.code}>/booking/your-slug</code> — print the QR from the dashboard.
          {` ${site.marketing.paymentFlowNote} ${site.marketing.mergeNote}`}
          Need an owner account?{" "}
          <Link href="/auth?tab=owner" className={ui.link}>
            Sign up
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
