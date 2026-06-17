import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { CheckoutPaidSuccessRegion } from "@/components/CheckoutPaidSuccessRegion";
import { CheckoutRefreshStatusButton } from "@/components/CheckoutRefreshStatusButton";
import { CheckoutReturnNav } from "@/components/CheckoutReturnNav";
import { CopyRefButton } from "@/components/CopyRefButton";
import { HitpayCheckoutSync } from "@/components/HitpayCheckoutSync";
import { PaymentStatusPoller } from "@/components/PaymentStatusPoller";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  studioClassesPath,
  studioEventsPath,
  studioHomePath,
  studioMemberZoneListPath,
  studioMemberZonePath,
  studioMePath,
  studioPackagePath,
  studioPackagesPath,
  studioShopPath,
} from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ studioSlug: string; payment_id: string }> };

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

function paymentMethodLabel(method: string | null | undefined, hasGatewayCheckout: boolean): string {
  const m = (method ?? "").toLowerCase();
  if (m === "hitpay" || hasGatewayCheckout) return "HitPay (PayNow, etc.)";
  if (m === "free") return "Free";
  if (m === "cash") return "Cash";
  if (m === "card") return "Card";
  if (m === "paynow") return "PayNow";
  if (m === "bank_transfer" || m === "transfer" || m === "bank") return "Bank transfer";
  if (!method) return "—";
  return method;
}

function paymentFailureTitle(status: string): string {
  if (status === "failed") return "Payment failed";
  if (status === "expired") return "Payment expired";
  if (status === "refunded") return "Refunded";
  return `Payment status: ${status}`;
}

function failedStateDescription(source: string, status: string): string {
  if (status === "refunded") return "This payment has been refunded.";
  const base = "This payment was not completed or the link is no longer valid.";
  if (source === "package_buy")
    return `${base} You have not been charged. You can return to packages and try again.`;
  if (source === "member_zone_purchase")
    return `${base} You can start a new purchase from the member zone.`;
  if (source === "shop_purchase")
    return `${base} You can return to the shop and try again.`;
  if (source === "online_booking")
    return `${base} Your hold will be released after the time limit — book again from classes.`;
  if (source === "event_booking")
    return `${base} Please place a new order from the event page.`;
  return `${base} Go back or return to the studio home and try again.`;
}

function failedPrimaryHref(
  studioSlug: string,
  source: string,
): { href: string; label: string } {
  if (source === "package_buy") {
    return { href: studioPackagesPath(studioSlug), label: "Browse packages" };
  }
  if (source === "member_zone_purchase") {
    return { href: studioMemberZoneListPath(studioSlug), label: "Member zone" };
  }
  if (source === "shop_purchase") {
    return { href: studioShopPath(studioSlug), label: "Browse shop" };
  }
  if (source === "event_booking") {
    return { href: studioEventsPath(studioSlug), label: "Browse events" };
  }
  return { href: studioClassesPath(studioSlug), label: "Browse classes" };
}

function checkoutNavContext(
  studioSlug: string,
  source: string,
  payment: {
    booking_id?: string | null;
    event_booking_id?: string | null;
  },
  memberZoneSeriesPath: string | null,
  packageDetailPath: string | null,
): { fallbackHref: string; fallbackLabel: string } {
  if (memberZoneSeriesPath) {
    return { fallbackHref: memberZoneSeriesPath, fallbackLabel: "Back to series" };
  }
  if (payment.booking_id) {
    return { fallbackHref: studioMePath(studioSlug, "bookings"), fallbackLabel: "Back to bookings" };
  }
  if (payment.event_booking_id) {
    return { fallbackHref: studioMePath(studioSlug, "bookings"), fallbackLabel: "Back to bookings" };
  }
  if (source === "package_buy") {
    if (packageDetailPath) {
      return { fallbackHref: packageDetailPath, fallbackLabel: "Back to package" };
    }
    return { fallbackHref: studioMePath(studioSlug, "class-passes"), fallbackLabel: "Back to passes" };
  }
  if (source === "member_zone_purchase") {
    return { fallbackHref: studioMemberZoneListPath(studioSlug), fallbackLabel: "Back to member zone" };
  }
  if (source === "shop_purchase") {
    return { fallbackHref: studioShopPath(studioSlug), fallbackLabel: "Back to shop" };
  }
  if (source === "event_booking") {
    return { fallbackHref: studioMePath(studioSlug, "bookings"), fallbackLabel: "Back to bookings" };
  }
  return { fallbackHref: studioHomePath(studioSlug), fallbackLabel: "Back to studio" };
}

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
      package_id,
      package_name_snapshot,
      gateway_checkout_url,
      gateway_payment_id,
      gateway_status,
      booking_id,
      event_booking_id,
      member_zone_series_id,
      member_zone_lesson_id,
      shop_product_id,
      shop_product_name_snapshot,
      is_gift,
      gift_recipient_email,
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
  const isFreePayment = (payment.payment_method ?? "").toLowerCase() === "free";

  const source = String(payment.source ?? "").toLowerCase();
  const packageId = (payment as { package_id?: string | null }).package_id ?? null;
  let packageDetailPath: string | null = null;
  if (packageId && source === "package_buy") {
    const { data: pkgRow } = await admin.from("packages").select("share_slug").eq("id", packageId).maybeSingle();
    if (pkgRow?.share_slug) {
      packageDetailPath = studioPackagePath(studioSlug, pkgRow.share_slug);
    }
  }

  const memberZoneSeriesId = (payment as { member_zone_series_id?: string | null }).member_zone_series_id ?? null;
  let memberZoneSeriesPath: string | null = null;
  if (memberZoneSeriesId) {
    const { data: mzSeries } = await admin
      .from("member_zone_series")
      .select("share_slug, studios(public_slug)")
      .eq("id", memberZoneSeriesId)
      .maybeSingle();
    const mzStudioSlug = mzSeries
      ? (Array.isArray(mzSeries.studios) ? mzSeries.studios[0]?.public_slug : (mzSeries.studios as { public_slug?: string | null } | null)?.public_slug)
      : null;
    if (mzStudioSlug && mzSeries?.share_slug) {
      memberZoneSeriesPath = studioMemberZonePath(mzStudioSlug, mzSeries.share_slug);
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
        ruleLine = `Cancel ≥${r.cancel_cutoff_hours ?? 12}h before class · Late cancel ${
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
  const shouldUseGatewaySync = Boolean(payment.gateway_payment_id);
  const gatewayStatus = (payment.gateway_status ?? "").toLowerCase();
  const isGatewayReceived =
    gatewayStatus === "completed" ||
    gatewayStatus === "succeeded" ||
    gatewayStatus === "paid";
  const holdWindowHint =
    source === "online_booking" || source === "event_booking"
      ? "Reservations are held for 15 minutes, then released automatically."
      : source === "package_buy" || source === "member_zone_purchase" || source === "shop_purchase"
        ? "This checkout link expires in about 30 minutes."
        : null;

  const nav = checkoutNavContext(
    studioSlug,
    source,
    payment as { booking_id?: string | null; event_booking_id?: string | null },
    memberZoneSeriesPath,
    packageDetailPath,
  );

  const expiresAt = payment.expires_at ? new Date(payment.expires_at) : null;
  const showExpiry = expiresAt && isPending;
  const packageNameSnapshot = (payment as { package_name_snapshot?: string | null }).package_name_snapshot ?? null;
  const shopProductNameSnapshot = (payment as { shop_product_name_snapshot?: string | null }).shop_product_name_snapshot ?? null;
  const itemNameSnapshot = packageNameSnapshot ?? shopProductNameSnapshot;
  const isGiftPayment = (payment as { is_gift?: boolean | null }).is_gift ?? false;
  const giftRecipientEmail = (payment as { gift_recipient_email?: string | null }).gift_recipient_email ?? null;
  const failedNav = failedPrimaryHref(studioSlug, source);

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      <div className="flex flex-col gap-5">
        <CheckoutReturnNav fallbackHref={nav.fallbackHref} fallbackLabel={nav.fallbackLabel} />

        <h1 className="sr-only">
          {isPaid ? "Payment confirmed" : isFailed ? paymentFailureTitle(payment.status) : isFreePayment ? "Completing your order" : "Complete your payment"}
        </h1>

        <div className="rounded-2xl bg-linear-to-br from-teal-600 to-teal-700 px-6 py-7 text-center shadow-lg shadow-teal-900/20 dark:from-teal-700 dark:to-teal-800">
          <p className="text-sm font-medium text-teal-100">{isPaid ? "Amount paid" : isFreePayment ? "Order total" : "Amount due"}</p>
          <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-white">
            {payment.currency} {Number(payment.amount).toFixed(2)}
          </p>
          {isPaid ? (
            <p className="mt-2 text-sm font-medium text-teal-100">Thank you — you&apos;re all set.</p>
          ) : isFreePayment ? (
            <>
              <p className="mt-2 text-sm text-teal-200">
                No payment is required for this order.
              </p>
              <p className="text-xs text-teal-300">We&apos;re confirming it automatically.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-teal-200">
                Pay to:{" "}
                <span className="font-semibold">
                  {isHitpay ? "HitPay checkout" : "Studio"}
                </span>
              </p>
              <p className="text-xs text-teal-300">Secure hosted payment page</p>
            </>
          )}
        </div>

        {isPending ? (
          <>
            <PaymentStatusPoller stop={shouldUseGatewaySync} intervalMs={15000} showHint={!isFreePayment} />
            <HitpayCheckoutSync
              paymentId={payment_id}
              studioSlug={studioSlug}
              enabled={shouldUseGatewaySync}
            />
          </>
        ) : null}

        {isPaid ? (
          <CheckoutPaidSuccessRegion className="flex flex-col items-stretch gap-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-teal-800/50 dark:bg-teal-950/30">
            <div className="flex flex-col items-center gap-2">
              <ShieldCheck size={28} className="text-teal-600 dark:text-teal-400" aria-hidden />
              <p className="text-lg font-semibold text-teal-900 dark:text-teal-200">Payment confirmed</p>
              {memberZoneSeriesPath ? (
                <>
                  <p className={`text-sm ${ui.muted}`}>Your purchase is confirmed. Enjoy the content.</p>
                  <Link href={memberZoneSeriesPath} className={`${ui.btnPrimary} mt-1 inline-flex justify-center`}>
                    Continue to series
                  </Link>
                </>
              ) : source === "shop_purchase" ? (
                <>
                  <p className={`text-sm ${ui.muted}`}>
                    {isGiftPayment && giftRecipientEmail
                      ? `This is a gift — a notification has been sent to ${giftRecipientEmail}.`
                      : "Your order is confirmed. We will ship to the address you provided."}
                  </p>
                  <Link href={studioMePath(studioSlug, "orders")} className={`${ui.btnPrimary} mt-1 inline-flex justify-center`}>
                    My orders
                  </Link>
                </>
              ) : source === "package_buy" ? (
                <>
                  <p className={`text-sm ${ui.muted}`}>
                    Your class passes are on your account. You can book sessions anytime.
                  </p>
                  <div className="mt-1 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                    {packageDetailPath ? (
                      <Link href={packageDetailPath} className={`${ui.btnPrimary} inline-flex justify-center sm:min-w-40`}>
                        View this package
                      </Link>
                    ) : null}
                    <Link
                      href={studioMePath(studioSlug, "class-passes")}
                      className={`${packageDetailPath ? ui.btnSecondary : ui.btnPrimary} inline-flex justify-center sm:min-w-40`}
                    >
                      My class passes
                    </Link>
                    <Link href={studioPackagesPath(studioSlug)} className={`${ui.btnSecondary} inline-flex justify-center sm:min-w-40`}>
                      Browse packages
                    </Link>
                  </div>
                </>
              ) : source === "event_booking" ? (
                <>
                  <p className={`text-sm ${ui.muted}`}>Your event booking is confirmed.</p>
                  <Link href={studioMePath(studioSlug, "bookings")} className={`${ui.btnPrimary} mt-1 inline-flex justify-center`}>
                    My bookings
                  </Link>
                </>
              ) : payment.booking_id ? (
                <>
                  <p className={`text-sm ${ui.muted}`}>Your class booking is confirmed. See you there.</p>
                  <Link href={studioMePath(studioSlug, "bookings")} className={`${ui.btnPrimary} mt-1 inline-flex justify-center`}>
                    My bookings
                  </Link>
                </>
              ) : (
                <>
                  <p className={`text-sm ${ui.muted}`}>Your payment was successful.</p>
                  <Link href={studioMePath(studioSlug, "orders")} className={`${ui.btnPrimary} mt-1 inline-flex justify-center`}>
                    My orders
                  </Link>
                </>
              )}

              <dl className="mt-4 w-full space-y-2 border-t border-teal-200/80 pt-4 text-left text-xs dark:border-teal-800/50">
                {itemNameSnapshot ? (
                  <>
                    <dt className={ui.muted}>Item</dt>
                    <dd className="text-teal-900 dark:text-teal-100">{itemNameSnapshot}</dd>
                  </>
                ) : null}
                {payment.reference_code ? (
                  <>
                    <dt className={ui.muted}>Reference (support)</dt>
                    <dd className="font-mono font-medium text-teal-900 dark:text-teal-100">{payment.reference_code}</dd>
                  </>
                ) : null}
                <dt className={ui.muted}>Payment method</dt>
                <dd className="text-teal-900 dark:text-teal-100">
                  {paymentMethodLabel(payment.payment_method, Boolean(payment.gateway_checkout_url))}
                </dd>
                {payment.verified_at ? (
                  <>
                    <dt className={ui.muted}>Confirmed at</dt>
                    <dd className="text-teal-900 dark:text-teal-100"><LocalTime iso={payment.verified_at} /></dd>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="border-t border-teal-200/80 pt-4 dark:border-teal-800/50">
              <CheckoutReturnNav variant="footer" fallbackHref={nav.fallbackHref} fallbackLabel={nav.fallbackLabel} />
            </div>
          </CheckoutPaidSuccessRegion>
        ) : null}

        {isFailed ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center dark:border-red-800/50 dark:bg-red-950/20">
            <XCircle size={28} className="text-red-500 dark:text-red-400" />
            <p className="text-lg font-semibold text-red-800 dark:text-red-300">{paymentFailureTitle(payment.status)}</p>
            <p className={`text-sm ${ui.muted}`}>{failedStateDescription(source, payment.status)}</p>
            {payment.status !== "refunded" ? (
              <div className="mt-3 flex w-full flex-col items-center gap-3">
                <Link href={failedNav.href} className={`${ui.btnSecondary} inline-flex justify-center`}>
                  {failedNav.label}
                </Link>
                <CheckoutReturnNav variant="footer" fallbackHref={nav.fallbackHref} fallbackLabel={nav.fallbackLabel} />
              </div>
            ) : null}
          </div>
        ) : null}

        {isPending ? (
          <>
            {payment.gateway_checkout_url ? (
              <div className="rounded-2xl border border-teal-200 bg-teal-50 px-5 py-5 dark:border-teal-800/50 dark:bg-teal-950/30">
                <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">Complete your payment</p>
                <p className={`mt-1 text-sm ${ui.muted}`}>
                  The button below opens HitPay in a new tab. When you&apos;re done, return to{" "}
                  <strong className="font-medium text-teal-800 dark:text-teal-200">this tab</strong>
                  — we&apos;ll update automatically. If nothing changes, refresh the page or use the button below.
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
                <CheckoutRefreshStatusButton />
                {showExpiry ? (
                  <p className="mt-3 text-xs text-teal-700 dark:text-teal-400">
                    Link expires <LocalTime iso={payment.expires_at} options={{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }} /> (your local time)
                  </p>
                ) : null}
                {holdWindowHint ? (
                  <p className={`mt-1 text-xs ${ui.muted}`}>{holdWindowHint}</p>
                ) : null}
              </div>
            ) : null}

            {!payment.gateway_checkout_url ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 dark:border-stone-700 dark:bg-stone-900/40">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
                    <Clock size={18} className="animate-pulse text-teal-600 dark:text-teal-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                      {isFreePayment ? "Completing your order" : "Waiting for payment confirmation"}
                    </p>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      {isFreePayment
                        ? "No payment is needed. We&apos;re finishing your order automatically."
                        : isGatewayReceived
                          ? "Payment received — confirming your order…"
                          : "Complete your transfer. We&apos;ll update this page once it&apos;s confirmed."}
                    </p>
                  </div>
                </div>
                {showExpiry ? (
                  <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">
                    {isFreePayment ? "Order hold expires " : "Link expires "}
                    <LocalTime iso={payment.expires_at} options={{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }} /> (your local time) · This page refreshes automatically
                  </p>
                ) : (
                  <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-500">
                    This page refreshes automatically
                  </p>
                )}
              </div>
            ) : null}

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

        {ruleLine ? (
          <p className={`rounded-xl border border-stone-100 px-3 py-2 text-xs ${ui.muted} dark:border-stone-800`}>
            {ruleLine}
          </p>
        ) : null}
      </div>
    </main>
  );
}
