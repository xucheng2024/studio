import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, XCircle } from "lucide-react";
import { ConfirmPaymentButton } from "@/components/ConfirmPaymentButton";
import { CopyRefButton } from "@/components/CopyRefButton";
import { QrDownloadButton } from "@/components/QrDownloadButton";
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
      qr_payload,
      paynow_proxy_type_snapshot,
      paynow_uen_snapshot,
      paynow_mobile_snapshot,
      paynow_payee_name_snapshot,
      customer_confirmed_at,
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
  const isFailed = payment.status === "failed" || payment.status === "expired";
  const isPending = !isPaid && !isFailed;

  return (
    /* Extra bottom padding so the sticky bar doesn't cover content */
    <main className="mx-auto w-full max-w-md px-4 pb-40 pt-8 sm:px-6 sm:pb-20 sm:pt-10">
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

        {/* ── Terminal states ── */}
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

        {isFailed ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center dark:border-red-800/50 dark:bg-red-950/20">
            <XCircle size={28} className="text-red-500 dark:text-red-400" />
            <p className="text-lg font-semibold text-red-800 dark:text-red-300">
              Payment {payment.status}
            </p>
            <p className={`text-sm ${ui.muted}`}>
              This payment link has expired or failed. Please start a new booking.
            </p>
            <Link href="/booking" className={`mt-2 text-sm ${ui.link}`}>
              ← Browse sessions
            </Link>
          </div>
        ) : null}

        {/* ── Steps (only shown when pending) ── */}
        {isPending ? (
          <div className="flex flex-col gap-3">

            {/* Step 1 – Scan QR */}
            {qrDataUrl ? (
              <div className={`${ui.card} flex flex-col items-center gap-3`}>
                <div className="flex w-full items-center gap-2">
                  <StepBadge n={1} />
                  <p className="font-semibold text-stone-800 dark:text-stone-100">Scan with your banking app</p>
                </div>
                {/* QR image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={`PayNow QR — ${payment.currency} ${Number(payment.amount).toFixed(2)}`}
                  width={240}
                  height={240}
                  className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700"
                />
                {/* Save to photos */}
                <QrDownloadButton dataUrl={qrDataUrl} amount={`${payment.currency} ${Number(payment.amount).toFixed(2)}`} />
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

          </div>
        ) : null}

        {/* ── Booking policy ── */}
        {ruleLine ? (
          <p className={`rounded-xl border border-stone-100 px-3 py-2 text-xs ${ui.muted} dark:border-stone-800`}>
            {ruleLine}
          </p>
        ) : null}

      </div>

      {/* ── Step 3: sticky "I've paid" bar (mobile) — in-flow on desktop ── */}
      {isPending ? (
        <div
          className="
            fixed bottom-0 left-0 right-0 z-30
            border-t border-stone-200 bg-white/95 px-4
            pb-[max(1rem,env(safe-area-inset-bottom))] pt-3
            shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md
            dark:border-stone-800 dark:bg-stone-950/95
            sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0
            sm:pb-0 sm:pt-0 sm:shadow-none sm:backdrop-blur-none
          "
        >
          {/* Step 3 label — only visible on mobile (fixed bar) */}
          <div className="mb-2 flex items-center gap-2 sm:hidden">
            <StepBadge n={3} />
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
              After paying, tap below
            </p>
          </div>
          <ConfirmPaymentButton
            paymentId={payment.id}
            expiresAt={payment.expires_at ?? null}
            referenceCode={payment.reference_code ?? null}
            paymentStatus={payment.status}
            customerConfirmedAt={payment.customer_confirmed_at ?? null}
          />
        </div>
      ) : null}
    </main>
  );
}

function StepBadge({ n, amber }: { n: number; amber?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        amber
          ? "bg-amber-500 text-white"
          : "bg-teal-600 text-white"
      }`}
    >
      {n}
    </span>
  );
}
