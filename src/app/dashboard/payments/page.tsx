import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { PaymentCopyButton } from "@/components/PaymentCopyButton";
import { PaymentMatchForm } from "@/components/PaymentMatchForm";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string; view?: string }> };

export default async function DashboardPaymentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const pendingOnly = sp.view === "pending-review";
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Create a studio from the overview first.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have payment access.</p>;
  }

  let query = supabase
    .from("payments")
    .select(
      `
      id,
      amount,
      currency,
      status,
      reference_code,
      expires_at,
      created_at,
      booking_id,
      customer_confirmed_at,
      customer_confirmation_note,
      verified_at,
      recon_status,
      paid_amount,
      recon_note
    `,
    )
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false });
  if (selectedLocationId) query = query.eq("location_id", selectedLocationId);
  const { data: payments } = await query;
  const sortedPayments = [...(payments ?? [])].sort((a, b) => {
    const aNeedsReview =
      a.status === "pending" && a.customer_confirmed_at != null && a.verified_at == null;
    const bNeedsReview =
      b.status === "pending" && b.customer_confirmed_at != null && b.verified_at == null;
    if (aNeedsReview !== bNeedsReview) return aNeedsReview ? -1 : 1;
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });
  const visiblePayments = pendingOnly
    ? sortedPayments.filter(
        (p) => p.status === "pending" && p.customer_confirmed_at != null && p.verified_at == null,
      )
    : sortedPayments;
  const nowMs = new Date().getTime();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Payments</h1>
        <p className={ui.muted}>Verify pending PayNow transfers and mark status.</p>
        <div className="mt-2 flex gap-3 text-sm">
          <a className={pendingOnly ? ui.link : ui.linkMuted} href="/dashboard/payments?view=pending-review">
            Pending review
          </a>
          <a className={!pendingOnly ? ui.link : ui.linkMuted} href="/dashboard/payments">
            All
          </a>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {visiblePayments.map((p) => {
          const needsReview =
            p.status === "pending" && p.customer_confirmed_at != null && p.verified_at == null;
          const slaOverdue =
            needsReview &&
            nowMs - new Date(p.customer_confirmed_at ?? 0).getTime() > 10 * 60 * 1000;
          return (
          <li
            key={p.id}
            className={`${ui.card} ${needsReview ? "border-amber-300 bg-amber-50/50 dark:border-amber-700/70 dark:bg-amber-950/20" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {p.currency} {Number(p.amount).toFixed(2)} · {p.status}
                </p>
                {needsReview ? (
                  <p className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                    Customer submitted · pending verification
                  </p>
                ) : null}
                <p className={ui.muted}>
                  Ref: <span className={ui.code}>{p.reference_code ?? "-"}</span>
                </p>
                <p className={ui.muted}>
                  Recon: {p.recon_status} · Paid amount: {p.currency} {Number(p.paid_amount ?? p.amount).toFixed(2)}
                </p>
                {p.recon_note ? <p className={ui.muted}>Recon note: {p.recon_note}</p> : null}
                <p className={ui.muted}>
                  Created: {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                </p>
                <p className={ui.muted}>
                  Expires: {p.expires_at ? new Date(p.expires_at).toLocaleString() : "-"}
                </p>
                <p className={ui.muted}>
                  Customer notice:{" "}
                  {p.customer_confirmed_at ? new Date(p.customer_confirmed_at).toLocaleString() : "not submitted"}
                </p>
                {p.customer_confirmation_note ? (
                  <p className={ui.muted}>Note: {p.customer_confirmation_note}</p>
                ) : null}
                {p.verified_at ? (
                  <p className={ui.muted}>Verified: {new Date(p.verified_at).toLocaleString()}</p>
                ) : null}
                {slaOverdue ? (
                  <p className="text-xs font-medium text-red-600 dark:text-red-400">
                    SLA overdue (&gt;10m)
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <PaymentCopyButton
                  text={`Amount: ${p.currency} ${Number(p.amount).toFixed(2)}\nRef: ${
                    p.reference_code ?? "-"
                  }\nCreated: ${p.created_at ? new Date(p.created_at).toLocaleString() : "-"}`}
                />
                {p.status === "pending" ? (
                  <>
                    <PaymentMarkButton paymentId={p.id} status="paid" label="Mark paid" />
                    <PaymentMarkButton paymentId={p.id} status="failed" label="Mark failed" />
                    <PaymentMarkButton paymentId={p.id} status="expired" label="Mark expired" />
                  </>
                ) : null}
                {p.status === "paid" ? (
                  <PaymentMarkButton paymentId={p.id} status="refunded" label="Mark refunded" />
                ) : null}
                {!p.booking_id ? <PaymentMatchForm paymentId={p.id} /> : null}
              </div>
            </div>
          </li>
          );
        })}
      </ul>
      {!visiblePayments.length ? <p className={ui.muted}>No payments yet.</p> : null}
    </div>
  );
}
