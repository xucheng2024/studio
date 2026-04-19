import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ShieldCheck, XCircle } from "lucide-react";
import { CopyRefButton } from "@/components/CopyRefButton";
import { QrDownloadButton } from "@/components/QrDownloadButton";
import { PaymentStatusPoller } from "@/components/PaymentStatusPoller";
import { toQrDataUrl } from "@/lib/paynow";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ payment_id: string }> };

function maskTail(value: string | null | undefined, visible = 4) {
  if (!value) return "-";
  const raw = String(value);
  if (raw.length <= visible) return raw;
  return `${"*".repeat(Math.max(0, raw.length - visible))}${raw.slice(-visible)}`;
}

export default async function PaymentCheckoutPage({ params }: Props) {
  const { payment_id } = await params;
  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select(
      `
      id,
      amount,
      currency,
      status,
      reference_code,
      expires_at,
      verified_at,
      qr_payload,
      paynow_proxy_type_snapshot,
      paynow_uen_snapshot,
      paynow_mobile_snapshot,
      paynow_payee_name_snapshot,
      booking_id
    `,
    )
    .eq("id", payment_id)
    .single();

  if (error || !payment) notFound();
  const qrDataUrl = payment.qr_payload ? await toQrDataUrl(payment.qr_payload) : null;

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
        } a credit · No-show after ${r.no_show_buffer_min ?? 15}m ${
          r.no_show_deduct_credit ? "deducts" : "returns"
        } a credit`;
      }
    }
  }

  const payeeProxy =
    payment.paynow_proxy_type_snapshot === "mobile"
      ? `Mobile ${maskTail(payment.paynow_mobile_snapshot)}`
      : payment.paynow_proxy_type_snapshot === "uen_mobile"
        ? `UEN ${maskTail(payment.paynow_uen_snapshot)} · Mobile ${maskTail(payment.paynow_mobile_snapshot)}`
        : `UEN ${maskTail(payment.paynow_uen_snapshot)}`;

  const isPaid = payment.status === "paid";
  const isFailed =
    payment.status === "failed" ||
    payment.status === "expired" ||
    payment.status === "refunded";
  const isPending = !isPaid && !isFailed;

  // Expiry display
  const expiresAt = payment.expires_at ? new Date(payment.expires_at) : null;
  const expiryLabel =
    expiresAt && isPending
      ? expiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        ", " +
        expiresAt.toLocaleDateString([], { month: "short", day: "numeric" })
      : null;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      {/* Auto-refresh every 20 s while payment is still pending */}
      <PaymentStatusPoller stop={!isPending} />

      <div className="flex flex-col gap-5">

        {/* ── Back link ── */}
        <Link href="/booking" className={`inline-flex items-center gap-1.5 text-sm ${ui.linkMuted} w-fit`}>
          <ArrowLeft size={14} />
          Back to booking
        </Link>

        {/* ── Amount hero ── */}
        <div className="rounded-2xl bg-linear-to-br from-teal-600 to-teal-700 px-6 py-7 text-center shadow-lg shadow-teal-900/20 dark:from-teal-700 dark:to-teal-800">
          <p className="text-sm font-medium text-teal-100">Amount due</p>
          <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-white">
            {payment.currency} {Number(payment.amount).toFixed(2)}
          </p>
          <p className="mt-2 text-sm text-teal-200">
            Pay to: <span className="font-semibold">{payment.paynow_payee_name_snapshot ?? "Studio"}</span>
          </p>
          <p className="text-xs text-teal-300">{payeeProxy}</p>
        </div>

        {/* ── Terminal: paid ── */}
        {isPaid ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-6 text-center dark:border-teal-800/50 dark:bg-teal-950/30">
            <ShieldCheck size={28} className="text-teal-600 dark:text-teal-400" />
            <p className="text-lg font-semibold text-teal-900 dark:text-teal-200">Payment confirmed</p>
            <p className={`text-sm ${ui.muted}`}>Your booking is locked in. See you at class!</p>
            <Link href="/me/bookings" className={`mt-2 text-sm ${ui.link}`}>
              View my bookings →
            </Link>
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
              <Link href="/booking" className={`mt-2 text-sm ${ui.link}`}>
                ← Browse sessions
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* ── Pending: payment instructions ── */}
        {isPending ? (
          <>
            {/* Step 1 – Scan QR */}
            {qrDataUrl ? (
              <div className={`${ui.card} flex flex-col items-center gap-3`}>
                <div className="flex w-full items-center gap-2">
                  <StepBadge n={1} />
                  <p className="font-semibold text-stone-800 dark:text-stone-100">Scan with your banking app</p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={`PayNow QR — ${payment.currency} ${Number(payment.amount).toFixed(2)}`}
                  width={240}
                  height={240}
                  className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700"
                />
                <QrDownloadButton
                  dataUrl={qrDataUrl}
                  amount={`${payment.currency} ${Number(payment.amount).toFixed(2)}`}
                />
              </div>
            ) : null}

            {/* Step 2 – Reference code */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-4 dark:border-amber-800/50 dark:bg-amber-950/20">
              <div className="mb-3 flex items-center gap-2">
                <StepBadge n={2} amber />
                <p className="font-semibold text-amber-900 dark:text-amber-200">Include this transfer reference</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <code className="text-2xl font-bold tracking-widest text-stone-900 dark:text-stone-100">
                  {payment.reference_code}
                </code>
                {payment.reference_code ? <CopyRefButton reference={payment.reference_code} /> : null}
              </div>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Add this to your transfer note so staff can match your payment instantly.
              </p>
            </div>

            {/* Waiting confirmation banner */}
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
                    Please complete your transfer. We&apos;ll confirm it shortly after receiving the payment.
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

function StepBadge({ n, amber }: { n: number; amber?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        amber ? "bg-amber-500 text-white" : "bg-teal-600 text-white"
      }`}
    >
      {n}
    </span>
  );
}
