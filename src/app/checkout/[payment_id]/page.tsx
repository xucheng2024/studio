import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ConfirmPaymentButton } from "@/components/ConfirmPaymentButton";
import { CopyRefButton } from "@/components/CopyRefButton";
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

  return (
    <main className={`${ui.page} sm:py-10`}>
      <div className="mx-auto flex max-w-md flex-col gap-6">

        {/* ── Back link ── */}
        <Link
          href="/booking"
          className={`inline-flex items-center gap-1.5 text-sm ${ui.linkMuted} w-fit`}
        >
          <ArrowLeft size={14} />
          Back to booking
        </Link>

        {/* ── Amount hero ── */}
        <div className="rounded-2xl bg-linear-to-br from-teal-600 to-teal-700 px-6 py-8 text-center shadow-lg shadow-teal-900/20 dark:from-teal-700 dark:to-teal-800">
          <p className="text-sm font-medium text-teal-100">Amount due</p>
          <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-white">
            {payment.currency} {Number(payment.amount).toFixed(2)}
          </p>
          <p className="mt-2 text-sm text-teal-200">
            Pay to: {payment.paynow_payee_name_snapshot ?? "Studio"}
          </p>
          <p className="text-xs text-teal-300">{payeeProxy}</p>
        </div>

        {/* ── QR code section ── */}
        {qrDataUrl ? (
          <section className={`${ui.card} flex flex-col items-center gap-4`}>
            <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">
              Scan with your banking app
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`PayNow QR code — ${payment.currency} ${Number(payment.amount).toFixed(2)}`}
              width={260}
              height={260}
              className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700"
            />
          </section>
        ) : null}

        {/* ── Reference code ── */}
        <section className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
            Transfer reference
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <code className="text-xl font-bold tracking-widest text-stone-900 dark:text-stone-100">
              {payment.reference_code}
            </code>
            {payment.reference_code ? <CopyRefButton reference={payment.reference_code} /> : null}
          </div>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Include this code in the transfer note — it lets staff match your payment instantly.
          </p>
        </section>

        {/* ── Confirm + countdown + note ── */}
        {!isPaid && !isFailed ? (
          <ConfirmPaymentButton
            paymentId={payment.id}
            expiresAt={payment.expires_at ?? null}
            referenceCode={payment.reference_code ?? null}
            paymentStatus={payment.status}
            customerConfirmedAt={payment.customer_confirmed_at ?? null}
          />
        ) : null}

        {/* ── Terminal states ── */}
        {isPaid ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-5 text-center dark:border-teal-800/50 dark:bg-teal-950/30">
            <ShieldCheck size={24} className="text-teal-600 dark:text-teal-400" />
            <p className="font-semibold text-teal-900 dark:text-teal-200">Payment confirmed</p>
            <p className={`text-sm ${ui.muted}`}>Your booking is locked in. See you at class!</p>
            <Link href="/me/bookings" className={`mt-1 text-sm ${ui.link}`}>
              View my bookings →
            </Link>
          </div>
        ) : null}

        {isFailed ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 dark:border-red-800/50 dark:bg-red-950/20">
            <p className="font-semibold text-red-800 dark:text-red-300">
              Payment {payment.status}
            </p>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              This payment link has expired or failed. Please start a new booking.
            </p>
            <Link href="/booking" className={`mt-2 block text-sm ${ui.link}`}>
              ← Browse sessions
            </Link>
          </div>
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
