import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  ShoppingBag,
  LayoutDashboard,
  CreditCard,
  Users,
  CheckCircle,
  ArrowRight,
  Zap,
  Shield,
  BarChart3,
  Bell,
  Clock,
  MapPin,
  Star,
} from "lucide-react";
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
    <div className="overflow-x-hidden">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-linear-to-b from-stone-50 via-white to-white dark:from-stone-950 dark:via-stone-950 dark:to-stone-950">
        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(#0d9488 1px,transparent 1px),linear-gradient(90deg,#0d9488 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-linear-to-b from-teal-400/20 to-transparent blur-3xl dark:from-teal-500/10" />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
          {/* Badge */}
          <div className="flex justify-center">
            <span className={ui.badge}>{site.badge}</span>
          </div>

          {/* Headline */}
          <h1 className="mx-auto mt-6 max-w-3xl text-center text-4xl font-bold leading-tight tracking-tight text-stone-900 dark:text-white sm:text-5xl lg:text-6xl">
            Run your studio without{" "}
            <span className="bg-linear-to-r from-teal-600 to-cyan-500 bg-clip-text text-transparent dark:from-teal-400 dark:to-cyan-400">
              the admin pile
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-center text-lg leading-relaxed text-stone-600 dark:text-stone-300">
            Hosted booking pages, automatic payment reconciliation, and a real-time front desk dashboard — built for Singapore fitness studios.
          </p>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/auth" className={ui.btnPrimary}>
              Get started free <ArrowRight size={16} />
            </Link>
            <Link href="/" className={ui.btnSecondary}>
              View live example
            </Link>
          </div>

          {/* Trust signals */}
          <p className="mt-5 text-center text-xs text-stone-400 dark:text-stone-500">
            No credit card required · Setup in under 10 minutes · Cancel anytime
          </p>

          {/* Dashboard mockup card */}
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-900">
              {/* Fake browser bar */}
              <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-950">
                <span className="size-3 rounded-full bg-red-400/70" />
                <span className="size-3 rounded-full bg-amber-400/70" />
                <span className="size-3 rounded-full bg-green-400/70" />
                <div className="ml-2 flex-1 rounded-md bg-stone-200/70 px-3 py-1 text-xs text-stone-400 dark:bg-stone-800">
                  sgmystudio.com/dashboard
                </div>
              </div>
              {/* Mock dashboard content */}
              <div className="grid divide-x divide-stone-100 dark:divide-stone-800 sm:grid-cols-3">
                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-400">Today&apos;s classes</p>
                  <p className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">6</p>
                  <p className="mt-1 text-xs text-stone-500">42 bookings confirmed</p>
                  <div className="mt-3 space-y-2">
                    {["Yoga Flow 9am · 8/10", "HIIT 11am · 6/8", "Pilates 2pm · 5/10"].map((s) => (
                      <div key={s} className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800">
                        <span className="size-2 rounded-full bg-teal-400" />
                        <span className="text-xs text-stone-700 dark:text-stone-300">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-400">Pending payments</p>
                  <p className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">3</p>
                  <p className="mt-1 text-xs text-stone-500">SGD 420.00 awaiting</p>
                  <div className="mt-3 space-y-2">
                    {["Sarah T. · SGD 180.00", "James L. · SGD 120.00", "Priya K. · SGD 120.00"].map((s) => (
                      <div key={s} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
                        <span className="size-2 rounded-full bg-amber-400" />
                        <span className="text-xs text-stone-700 dark:text-stone-300">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-400">Revenue this month</p>
                  <p className="mt-1 text-3xl font-bold text-stone-900 dark:text-white">SGD 4,820</p>
                  <p className="mt-1 text-xs text-stone-500">↑ 12% from last month</p>
                  <div className="mt-3 flex items-end gap-1 h-10">
                    {[40, 60, 45, 80, 70, 90, 75, 100, 85, 95, 88, 100].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm bg-teal-500/30"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pain points ───────────────────────────────────────────────────── */}
      <section className="border-y border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            Sound familiar?
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl text-center text-2xl font-bold tracking-tight text-stone-900 dark:text-white sm:text-3xl">
            Every studio owner knows this nightmare
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "💬",
                title: "WhatsApp chaos",
                desc: "Chasing payment screenshots, manually confirming bookings, losing track of who paid and who didn't.",
              },
              {
                icon: "📊",
                title: "Spreadsheet hell",
                desc: "Maintaining attendance records across multiple Google Sheets, reconciling bank transfers one by one.",
              },
              {
                icon: "💸",
                title: "No-shows cost you",
                desc: "Members cancel last-minute or just don't show up. No system enforces the rules automatically.",
              },
              {
                icon: "🔁",
                title: "Manual bank matching",
                desc: "Matching PayNow transfers to the right member and the right class, every single day.",
              },
              {
                icon: "📦",
                title: "Package tracking headaches",
                desc: "Counting remaining class passes per member in your head or on a notebook. Never accurate.",
              },
              {
                icon: "📅",
                title: "Double-bookings happen",
                desc: "Without real-time inventory, overbooking classes is a recurring, embarrassing problem.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-stone-200/80 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-900"
              >
                <span className="text-2xl">{item.icon}</span>
                <h3 className="mt-3 text-sm font-semibold text-stone-900 dark:text-stone-100">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Core features ─────────────────────────────────────────────────── */}
      <section className="bg-white dark:bg-stone-950">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            How Studio fixes it
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl text-center text-2xl font-bold tracking-tight text-stone-900 dark:text-white sm:text-3xl">
            Everything in one place, nothing to chase
          </h2>

          <div className="mt-14 grid gap-8 lg:grid-cols-2">
            {/* Feature 1 */}
            <div className="flex gap-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
                <CalendarDays size={22} />
              </div>
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">Hosted booking page</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  Share your studio URL — members browse classes, check availability, and book instantly. Seat is held in real time. No app download required.
                </p>
                <ul className="mt-3 space-y-1">
                  {["Real-time availability", "Class pass or online payment", "Instant booking confirmation"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                      <CheckCircle size={12} className="shrink-0 text-teal-500" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="flex gap-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                <CreditCard size={22} />
              </div>
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">Automatic payment reconciliation</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  Powered by HitPay. Payments hit your dashboard the moment they're confirmed. No more matching transfer screenshots against a spreadsheet.
                </p>
                <ul className="mt-3 space-y-1">
                  {["PayNow, card & e-wallets", "Gateway callbacks update status instantly", "Invoice PDFs auto-generated"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                      <CheckCircle size={12} className="shrink-0 text-teal-500" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="flex gap-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                <ShoppingBag size={22} />
              </div>
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">Class packages &amp; memberships</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  Sell class packs online. Members use their passes to book any class — no more counting in a notebook. Memberships auto-renew and deduct automatically.
                </p>
                <ul className="mt-3 space-y-1">
                  {["Sell packages with expiry", "Recurring membership billing", "Pass balance tracked per member"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                      <CheckCircle size={12} className="shrink-0 text-teal-500" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="flex gap-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <LayoutDashboard size={22} />
              </div>
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100">Front desk dashboard</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
                  Today's arrivals, pending payments, and walk-in check-ins — visible the moment you open the tab. Your reception team needs zero training.
                </p>
                <ul className="mt-3 space-y-1">
                  {["Daily class roster with arrival status", "Walk-in booking & payment in seconds", "Full payment history & export"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                      <CheckCircle size={12} className="shrink-0 text-teal-500" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="border-y border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            Get started in minutes
          </p>
          <h2 className="mx-auto mt-3 max-w-xl text-center text-2xl font-bold tracking-tight text-stone-900 dark:text-white sm:text-3xl">
            Three steps to a fully running studio
          </h2>

          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                icon: <Zap size={20} />,
                color: "teal",
                title: "Create your studio",
                desc: "Sign up, enter your studio name, and choose your booking URL — sgmystudio.com/your-slug. Takes 5 minutes.",
              },
              {
                step: "02",
                icon: <CalendarDays size={20} />,
                color: "violet",
                title: "Add classes & packages",
                desc: "Set your schedule, prices, capacity, and cancellation policy. Connect HitPay for online payments.",
              },
              {
                step: "03",
                icon: <Users size={20} />,
                color: "emerald",
                title: "Share with members",
                desc: "Send members your booking link. They browse, book, and pay — you watch the dashboard fill up.",
              },
            ].map((item) => (
              <div key={item.step} className="relative flex flex-col items-center text-center">
                <div
                  className={`flex size-14 items-center justify-center rounded-2xl ${
                    item.color === "teal"
                      ? "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300"
                      : item.color === "violet"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                  }`}
                >
                  {item.icon}
                </div>
                <span className="mt-4 text-xs font-bold tracking-widest text-stone-300 dark:text-stone-600">
                  {item.step}
                </span>
                <h3 className="mt-1 font-semibold text-stone-900 dark:text-stone-100">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Additional features strip ─────────────────────────────────────── */}
      <section className="bg-white dark:bg-stone-950">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: <Bell size={18} />,
                bg: "bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
                title: "Push notifications",
                desc: "Members get notified when new classes or packages drop — even without opening the app.",
              },
              {
                icon: <Shield size={18} />,
                bg: "bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
                title: "Member zone",
                desc: "Lock exclusive content — videos, guides, schedules — for paying members only.",
              },
              {
                icon: <BarChart3 size={18} />,
                bg: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                title: "Exportable records",
                desc: "Filter payment history by date, session, or member. Download CSV in one click.",
              },
              {
                icon: <Clock size={18} />,
                bg: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                title: "Automatic hold expiry",
                desc: "Reserved spots release automatically if payment is abandoned. No manual follow-up.",
              },
            ].map((item) => (
              <div key={item.title} className="flex flex-col gap-3">
                <span className={`inline-flex size-10 items-center justify-center rounded-xl ${item.bg}`}>
                  {item.icon}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Open studios strip ────────────────────────────────────────────── */}
      <section className="border-y border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">See it in action</p>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                Browse live studio booking pages powered by Studio.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 dark:border-stone-700 dark:bg-stone-900">
                <MapPin size={14} className="text-stone-400" />
                <code className="font-mono text-sm text-stone-700 dark:text-stone-300">sgmystudio.com/your-slug</code>
              </div>
              <Link href="/" className={ui.link}>
                Open studios <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-linear-to-br from-teal-700 via-teal-600 to-cyan-600 dark:from-teal-800 dark:via-teal-700 dark:to-cyan-700">
        <div className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 50%, white 1px, transparent 1px), radial-gradient(circle at 70% 80%, white 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <Star size={24} className="mx-auto text-teal-200/70" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to end the admin pile?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-teal-100">
            Set up your studio in under 10 minutes. Share your booking link the same day.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-lg shadow-teal-900/20 transition hover:bg-teal-50 active:scale-[0.98]"
            >
              Get started free <ArrowRight size={16} />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-teal-400/50 bg-transparent px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10 active:scale-[0.98]"
            >
              Go to dashboard
            </Link>
          </div>
          <p className="mt-5 text-xs text-teal-200/80">
            Free to start · No credit card · Singapore-based support
          </p>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <span className="text-sm font-semibold text-stone-700 dark:text-stone-300">{site.name}</span>
            <span className="text-xs text-stone-400">Built for gyms, yoga &amp; wellness studios in Singapore.</span>
            <div className="flex items-center gap-4 text-xs">
              <a
                href={`mailto:${site.contactEmail}`}
                className={ui.linkMuted}
              >
                {site.contactEmail}
              </a>
              <Link href="/auth" className={ui.linkMuted}>Sign in →</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
