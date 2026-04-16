import Link from "next/link";
import { notFound } from "next/navigation";
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
        ruleLine = `Cancel before ${r.cancel_cutoff_hours ?? 12}h; late-cancel ${
          r.late_cancel_deduct_credit ? "deducts" : "returns"
        } credit; no-show ${r.no_show_deduct_credit ? "deducts" : "returns"} credit after ${
          r.no_show_buffer_min ?? 15
        }m buffer.`;
      }
    }
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className={ui.h1}>PayNow checkout</h1>
          <p className={ui.lead}>
            Scan to pay, then tap <strong>I have paid</strong>. Frontdesk will verify and confirm your booking.
          </p>
        </div>

        <section className={ui.card}>
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt="PayNow QR"
                width={320}
                height={320}
                className="rounded-lg border border-stone-200 bg-white p-2"
              />
            ) : null}
            <p className="text-3xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {payment.currency} {Number(payment.amount).toFixed(2)}
            </p>
            <p className={ui.muted}>
              Reference: <span className={ui.code}>{payment.reference_code}</span>
            </p>
            <p className={ui.muted}>
              PayNow payee:{" "}
              {payment.paynow_payee_name_snapshot ?? "Payee"} ·{" "}
              {payment.paynow_proxy_type_snapshot === "mobile"
                ? `Mobile ${maskTail(payment.paynow_mobile_snapshot)}`
                : payment.paynow_proxy_type_snapshot === "uen_mobile"
                  ? `UEN ${maskTail(payment.paynow_uen_snapshot)} · Mobile ${maskTail(payment.paynow_mobile_snapshot)}`
                  : `UEN ${maskTail(payment.paynow_uen_snapshot)}`}
            </p>
            {payment.reference_code ? <CopyRefButton reference={payment.reference_code} /> : null}
            <p className={ui.muted}>Please include this reference in your transfer note to speed up verification.</p>
            {ruleLine ? <p className={`text-sm ${ui.muted}`}>{ruleLine}</p> : null}
            <ConfirmPaymentButton
              paymentId={payment.id}
              expiresAt={payment.expires_at ?? null}
              referenceCode={payment.reference_code ?? null}
              paymentStatus={payment.status}
              customerConfirmedAt={payment.customer_confirmed_at ?? null}
            />
            {payment.customer_confirmed_at ? (
              <p className={ui.muted}>
                Submitted: {new Date(payment.customer_confirmed_at).toLocaleString()} (waiting for staff review)
              </p>
            ) : null}
            {payment.status === "pending" && !payment.customer_confirmed_at ? (
              <p className={ui.muted}>Status: waiting for your payment notice</p>
            ) : null}
            {payment.status === "pending" && payment.customer_confirmed_at ? (
              <p className={ui.muted}>Status: pending staff verification</p>
            ) : null}
            {payment.status !== "pending" ? (
              <p className={ui.success}>Current status: {payment.status}</p>
            ) : null}
          </div>
        </section>

        <Link href="/booking" className={ui.link}>
          Back to booking
        </Link>
      </div>
    </main>
  );
}
