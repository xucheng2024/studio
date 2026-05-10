import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { CopyRefButton } from "@/components/CopyRefButton";
import { HitpayCheckoutSync } from "@/components/HitpayCheckoutSync";
import { PaymentStatusPoller } from "@/components/PaymentStatusPoller";
import { studioClassesPath, studioMemberZonePath, studioMePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ studioSlug: string; payment_id: string }> };

export default async function PaymentCheckoutPage({ params }: Props) {
  const { studioSlug: rawStudioSlug, payment_id } = await params;
  const routeStudioSlug = normalizeStudioSlug(rawStudioSlug);
  if (!routeStudioSlug) notFound();
  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select(
      `
      id,
      amount,
      currency,
      payment_method,
      status,
      source,
      reference_code,
      expires_at,
      verified_at,
      gateway_checkout_url,
      gateway_payment_id,
      gateway_status,
      booking_id,
      member_zone_series_id,
      member_zone_lesson_id,
      studios(public_slug)
    `,
    )
    .eq("id", payment_id)
    .single();

  if (error || !payment) notFound();
  const paymentStudioRaw = (payment as { studios?: { public_slug?: string | null } | { public_slug?: string | null }[] | null }).studios;
  const paymentStudio = Array.isArray(paymentStudioRaw) ? paymentStudioRaw[0] : paymentStudioRaw;
  const studioSlug = normalizeStudioSlug(paymentStudio?.public_slug ?? routeStudioSlug);
  if (!studioSlug || studioSlug !== routeStudioSlug) notFound();
  const isHitpay = (payment.payment_method ?? "").toLowerCase() === "hitpay" || Boolean(payment.gateway_checkout_url);

  const memberZoneSeriesId = (payment as { member_zone_series_id?: string | null }).member_zone_series_id ?? null;
  let memberZoneSeriesPath: string | null = null;
  if (memberZoneSeriesId) {
    const { data: mzSeries } = await admin
      .from("member_zone_series")
      .select("share_slug, studios(public_slug)")
      .eq("id", memberZoneSeriesId)
      .maybeSingle();
    const studioSlug = mzSeries
      ? (Array.isArray(mzSeries.studios) ? mzSeries.studios[0]?.public_slug : (mzSeries.studios as { public_slug?: string | null } | null)?.public_slug)
      : null;
    if (studioSlug && mzSeries?.share_slug) {
      memberZoneSeriesPath = studioMemberZonePath(studioSlug, mzSeries.share_slug);
    }
  }

  let ruleLine: string | null = null;
  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("location_id, class_sessions!inner(classes!inner(studio_id))")
      .eq("id", payment.booking_id)
      .maybeSingle();
    const session = booking?.class_sessions as
      | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }
      | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const studioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
    const locationId = (booking as { location_id?: string } | null)?.location_id ?? null;
    if (studioId) {
      const q = admin
        .from("booking_rules")
        .select("cancel_cutoff_hours, late_cancel_deduct_credit, no_show_deduct_credit, no_show_buffer_min")
        .eq("studio_id", studioId)
        .limit(1);
      const { data: r } = locationId
        ? await q.eq("location_id", locationId).maybeSingle()
        : await q.is("location_id", null).maybeSingle();
      if (r) {
        ruleLine = `Cancel ≥${r.cancel_cutoff_hours ?? 12}h before class · Late-cancel ${
          r.late_cancel_deduct_credit ? "deducts" : "returns"
        } a class pass · No-show after ${r.no_show_buffer_min ?? 15}m ${
          r.no_show_deduct_credit ? "deducts" : "returns"
        } a class pass`;
      }
    }
  }

  const isPaid = payment.status === "paid";
  const isFailed =
    payment.status === "failed" ||
    payment.status === "expired" ||
    payment.status === "refunded";
  const isPending = !isPaid && !isFailed;
  const gatewayStatus = (payment.gateway_status ?? "").toLowerCase();
  const isGatewayReceived =
    gatewayStatus === "completed" ||
    gatewayStatus === "succeeded" ||
    gatewayStatus === "paid";
  const source = String(payment.source ?? "").toLowerCase();
  const holdWindowHint =
    source === "online_booking" || source === "event_booking"
      ? "Reservations are held for 15 minutes, then released automatically."
      : source === "package_buy" || source === "member_zone_purchase"
        ? "This checkout expires in 30 minutes."
        : null;

  // Expiry display
  const expiresAt = payment.expires_at ? new Date(payment.expires_at) : null;
  const expiryLabel =
    expiresAt && isPending
      ? expiresAt.toLocaleString("en-SG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" })
      : null;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      {/* Auto-refresh every 5 s while payment is still pending */}
      <PaymentStatusPoller stop={!isPending} />
      <HitpayCheckoutSync
        paymentId={payment_id}
        enabled={isPending && Boolean(payment.gateway_payment_id)}
      />

      <div className="flex flex-col gap-5">

        {/* ── Back link ── */}
        <Link
          href={memberZoneSeriesPath ?? (payment.booking_id ? studioMePath(studioSlug, "bookings") : studioClassesPath(studioSlug))}
          className={`inline-flex items-center gap-1.5 text-sm ${ui.linkMuted} w-fit`}
        >
          <ArrowLeft size={14} />
          {memberZoneSeriesPath ? "Back to series" : payment.booking_id ? "My bookings" : "Browse packages"}
        </Link>

        {/* ── Page title (visually hidden, for a11y / SEO) ── */}
        <h1 className="sr-only">
          {isPaid ? "Payment confirmed" : isFailed ? `Payment ${payment.status}` : "Complete your payment"}
        </h1>

        {/* ── Amount hero ── */}
        <div className="rounded-2xl bg-linear-to-br from-teal-600 to-teal-700 px-6 py-7 text-center shadow-lg shadow-teal-900/20 dark:from-teal-700 dark:to-teal-800">
          <p className="text-sm font-medium text-teal-100">Amount due</p>
          <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-white">
            {payment.currency} {Number(payment.amount).toFixed(2)}
          </p>
          <p className="mt-2 text-sm text-teal-200">
            Pay to:{" "}
            <span className="font-semibold">
              {isHitpay ? "HitPay Checkout" : "Studio"}
            </span>
          </p>
          <p className="text-xs text-teal-300">Secure hosted payment page</p>
        </div>

        {/* ── Terminal: paid ── */}
        {isPaid ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-6 text-center dark:border-teal-800/50 dark:bg-teal-950/30">
            <ShieldCheck size={28} className="text-teal-600 dark:text-teal-400" />
            <p className="text-lg font-semibold text-teal-900 dark:text-teal-200">Payment confirmed</p>
            {memberZoneSeriesPath ? (
              <>
                <p className={`text-sm ${ui.muted}`}>Your purchase is confirmed. Enjoy the content!</p>
                <Link href={memberZoneSeriesPath} className={`mt-2 text-sm ${ui.link}`}>
                  Watch now →
                </Link>
              </>
            ) : (
              <>
                <p className={`text-sm ${ui.muted}`}>Your booking is locked in. See you at class!</p>
                <Link href={studioMePath(studioSlug, "bookings")} className={`mt-2 text-sm ${ui.link}`}>
                  View my bookings →
                </Link>
              </>
            )}
          </div>
        ) : null}

        {/* ── Terminal: failed / expired / refunded ── */}
        {isFailed ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center dark:border-red-800/50 dark:bg-red-950/20">
            <XCircle size={28} className="text-red-500 dark:text-red-400" />
            <p className="text-lg font-semibold text-red-800 dark:text-red-300 capitalize">
              Payment {payment.status}
            </p>
            <p className={`text-sm ${ui.muted}`}>
              {payment.status === "refunded"
                ? "This payment has been refunded."
                : "This payment link has expired or failed. Please start a new booking."}
            </p>
            {payment.status !== "refunded" ? (
              <Link href={studioClassesPath(studioSlug)} className={`mt-2 text-sm ${ui.link}`}>
                ← Browse sessions
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* ── Pending: payment instructions ── */}
        {isPending ? (
          <>
            {/* Primary action: HitPay checkout (when URL exists) */}
            {payment.gateway_checkout_url ? (
              <div className="rounded-2xl border border-teal-200 bg-teal-50 px-5 py-5 dark:border-teal-800/50 dark:bg-teal-950/30">
                <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">Complete your payment</p>
                <p className={`mt-1 text-sm ${ui.muted}`}>
                  Click below to open the secure checkout. This page updates automatically once payment is confirmed.
                </p>
                <a
                  href={payment.gateway_checkout_url}
                  className={`${ui.btnPrimary} mt-4 inline-flex w-full items-center justify-center gap-2`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Continue to HitPay
                  <ExternalLink size={14} />
                </a>
                {expiryLabel ? (
                  <p className="mt-3 text-xs text-teal-700 dark:text-teal-400">
                    Link expires at {expiryLabel}
                  </p>
                ) : null}
                {holdWindowHint ? (
                  <p className={`mt-1 text-xs ${ui.muted}`}>{holdWindowHint}</p>
                ) : null}
              </div>
            ) : null}

            {/* Waiting confirmation banner (when no checkout URL — e.g. manual bank transfer) */}
            {!payment.gateway_checkout_url ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 dark:border-stone-700 dark:bg-stone-900/40">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
                    <Clock size={18} className="animate-pulse text-teal-600 dark:text-teal-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                      Waiting for payment confirmation
                    </p>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      {isGatewayReceived
                        ? "Payment received — confirming your booking now…"
                        : "Please complete your transfer. We'll confirm it shortly."}
                    </p>
                  </div>
                </div>
                {expiryLabel ? (
                  <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">
                    Link expires at {expiryLabel} · This page updates automatically
                  </p>
                ) : (
                  <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">
                    This page updates automatically
                  </p>
                )}
              </div>
            ) : null}

            {/* Reference code — secondary, for support use */}
            {payment.reference_code ? (
              <details className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/40">
                <summary className={`cursor-pointer select-none text-xs font-medium ${ui.muted}`}>
                  Payment reference (for support)
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <code className="text-xl font-bold tracking-widest text-stone-900 dark:text-stone-100">
                    {payment.reference_code}
                  </code>
                  <CopyRefButton reference={payment.reference_code} />
                </div>
              </details>
            ) : null}
          </>
        ) : null}

        {/* ── Booking policy ── */}
        {ruleLine ? (
          <p className={`rounded-xl border border-stone-100 px-3 py-2 text-xs ${ui.muted} dark:border-stone-800`}>
            {ruleLine}
          </p>
        ) : null}

      </div>
    </main>
  );
}

