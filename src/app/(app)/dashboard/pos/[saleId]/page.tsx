import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SyncHitpayPaymentButton } from "@/components/SyncHitpayPaymentButton";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { PosHitpayPaymentButton } from "@/components/dashboard/PosHitpayPaymentButton";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { completePosCashSaleAction, voidPosSaleAction } from "@/app/(app)/dashboard/actions";
import { PosRefundForm } from "@/components/dashboard/PosRefundForm";
import { formatLocalDateTime } from "@/lib/date";
import { getPosSaleDetailForDashboard } from "@/lib/pos-sales-read";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<{ studio_id?: string; location_id?: string; payment_status?: string }>;
};

function toStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function toPaymentProgressLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "partially_refunded":
      return "Partially refunded";
    case "refunded":
      return "Refunded";
    case "failed_or_expired":
      return "Failed";
    default:
      return "No payment";
  }
}

function paymentMethodLabel(method: string | null | undefined) {
  const m = String(method ?? "").toLowerCase();
  if (m === "hitpay") return "HitPay";
  if (m === "cash") return "Cash";
  if (m === "free") return "Free";
  if (!method) return "-";
  return method;
}

function formatQty(value: number) {
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.0005) {
    return String(Math.round(value));
  }
  return String(value);
}

export default async function PosSaleDetailPage({ params, searchParams }: Props) {
  const { saleId } = await params;
  const sp = await searchParams;
  const studioId = sp.studio_id?.trim() ?? "";
  const locationId = sp.location_id?.trim() || null;

  if (!studioId) {
    return <p className={ui.muted}>Missing studio scope. Please return to POS list and re-open this sale.</p>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const detailResult = await getPosSaleDetailForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId,
    saleId,
    locationId,
  });

  const backQuery = new URLSearchParams();
  backQuery.set("studio_id", studioId);
  if (locationId) backQuery.set("location_id", locationId);

  if (!detailResult.ok) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={`/dashboard/pos?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to POS list
        </DashboardAppLink>
        <p className={detailResult.code === "not_found" ? ui.muted : ui.error}>
          {detailResult.code === "not_found"
            ? "Sale not found in current scope."
            : `Could not load sale detail: ${detailResult.message}`}
        </p>
      </div>
    );
  }

  const { sale, items } = detailResult.detail;
  const admin = createAdminClient();
  const { data: activeStudio } = await admin
    .from("studios")
    .select("public_slug")
    .eq("id", studioId)
    .maybeSingle();
  const activeStudioSlug = activeStudio?.public_slug?.trim() ?? null;

  const paymentQuery = new URLSearchParams(backQuery.toString());
  paymentQuery.set("source", "pos_sale");
  paymentQuery.set("q", sale.id);
  if (sale.payment_progress.latest_payment_id) {
    paymentQuery.set("payment_id", sale.payment_progress.latest_payment_id);
  }

  const canRefundItems =
    (sale.status === "paid" || sale.status === "partially_refunded")
    && detailResult.role !== "frontdesk";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <DashboardAppLink href={`/dashboard/pos?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to POS
        </DashboardAppLink>
        <span className={`${ui.badgeNeutral} capitalize`}>{toStatusLabel(sale.status)}</span>
      </div>

      {sp.payment_status === "pending" && sale.payment_progress.status !== "paid" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Checking payment status… if the customer cancelled or the card was declined, use “Sync HitPay” below or try again.
        </div>
      ) : null}

      <section className={ui.card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={ui.h1}>{sale.sale_number ?? sale.id.slice(0, 8)}</h1>
            <p className={`mt-1 ${ui.muted}`}>
              {sale.customer_name ?? "Walk-in"} · {sale.location_name ?? "Location"} · {sale.currency} {Number(sale.total_amount).toFixed(2)}
            </p>
            {sale.receipt_number ? (
              <p className="mt-1 text-sm font-medium text-teal-800 dark:text-teal-300">
                Receipt <span>{sale.receipt_number}</span>
              </p>
            ) : null}
          </div>
          {sale.status === "draft" || sale.status === "pending_payment" ? (
            <DashboardAppLink
              href={`/dashboard/pos?studio_id=${studioId}&location_id=${sale.location_id}&sale_id=${sale.id}`}
              className={ui.btnSecondarySm}
            >
              Continue in cashier
            </DashboardAppLink>
          ) : null}
        </div>
        <details className="mt-4 rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
          <summary className="cursor-pointer text-sm font-medium text-stone-700 dark:text-stone-300">Sale details</summary>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className={`text-xs ${ui.muted}`}>Created</dt>
              <dd>{formatLocalDateTime(sale.created_at)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Paid</dt>
              <dd>{sale.paid_at ? formatLocalDateTime(sale.paid_at) : "-"}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Payment progress</dt>
              <dd>{toPaymentProgressLabel(sale.payment_progress.status)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Subtotal</dt>
              <dd>{sale.currency} {Number(sale.subtotal_amount).toFixed(2)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Discount</dt>
              <dd>{sale.currency} {Number(sale.discount_amount).toFixed(2)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Refunded</dt>
              <dd>{sale.currency} {Number(sale.refunded_amount).toFixed(2)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Cash session</dt>
              <dd>
                {sale.cash_session_id ? (
                  <DashboardAppLink
                    href={`/dashboard/pos/cash-sessions/${sale.cash_session_id}?studio_id=${studioId}&location_id=${sale.location_id}`}
                    className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                  >
                    Open session
                  </DashboardAppLink>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt className={`text-xs ${ui.muted}`}>Note</dt>
              <dd>{sale.note ?? "-"}</dd>
            </div>
          </dl>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/payments?${paymentQuery.toString()}`} className={ui.btnSecondarySm}>
            Open payment record
          </DashboardAppLink>
          {sale.status === "pending_payment" ? (
            <>
              <PosHitpayPaymentButton
                studioId={studioId}
                saleId={sale.id}
              />
              <ServerActionToastForm action={completePosCashSaleAction} refreshOnSuccess>
                <input type="hidden" name="studio_id" value={studioId} />
                <input type="hidden" name="sale_id" value={sale.id} />
                <input type="hidden" name="idempotency_key" value={`pos-cash-complete:${sale.id}:${sale.updated_at}`} />
                <button type="submit" className={ui.btnPrimarySm}>
                  Mark as paid (cash)
                </button>
              </ServerActionToastForm>
            </>
          ) : null}
          {sale.status === "draft" || sale.status === "pending_payment" ? (
            <ToastConfirmForm
              action={voidPosSaleAction}
              confirmMessage="Void this sale? This action cannot be undone from POS."
              confirmLabel="Void sale"
              pendingLabel="Voiding…"
              requireText="VOID"
            >
              <input type="hidden" name="studio_id" value={studioId} />
              <input type="hidden" name="sale_id" value={sale.id} />
              <input type="hidden" name="reason" value="voided_from_pos_detail" />
              <input type="hidden" name="idempotency_key" value={`pos-void:${sale.id}:${sale.updated_at}`} />
              <button type="submit" className={ui.btnDangerSm}>
                Void sale
              </button>
            </ToastConfirmForm>
          ) : null}
        </div>
      </section>

      <section className={`${ui.card} overflow-x-auto`}>
        <h2 className={ui.h2}>Payment records</h2>
        {detailResult.detail.payments.length === 0 ? (
          <p className={`mt-3 ${ui.muted}`}>No payment records linked yet.</p>
        ) : (
          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Cash session</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Ref</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {detailResult.detail.payments.map((payment) => {
                const onePaymentQuery = new URLSearchParams(backQuery.toString());
                onePaymentQuery.set("source", "pos_sale");
                onePaymentQuery.set("payment_id", payment.id);
                return (
                  <tr key={payment.id} className="border-b border-stone-100 align-top last:border-b-0 dark:border-stone-900">
                    <td className="px-3 py-2 capitalize">{toStatusLabel(payment.status)}</td>
                    <td className="px-3 py-2">{paymentMethodLabel(payment.payment_method)}</td>
                    <td className="px-3 py-2">
                      {payment.cash_session_id ? (
                        <DashboardAppLink
                          href={`/dashboard/pos/cash-sessions/${payment.cash_session_id}?studio_id=${studioId}&location_id=${sale.location_id}`}
                          className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                        >
                          {payment.cash_session_id}
                        </DashboardAppLink>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">{payment.currency} {Number(payment.amount).toFixed(2)}</td>
                    <td className="px-3 py-2"><span className={ui.code}>{payment.reference_code ?? "-"}</span></td>
                    <td className="px-3 py-2">{formatLocalDateTime(payment.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <DashboardAppLink
                          href={`/dashboard/payments?${onePaymentQuery.toString()}`}
                          className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                        >
                          Open
                        </DashboardAppLink>
                        {activeStudioSlug && payment.status === "pending" && (payment.payment_method ?? "").toLowerCase() === "hitpay" ? (
                          <SyncHitpayPaymentButton paymentId={payment.id} studioSlug={activeStudioSlug} />
                        ) : null}
                        {payment.invoice_status !== "void" && Number(payment.amount ?? 0) > 0 ? (
                          <InvoiceSendButton
                            paymentId={payment.id}
                            invoiceNumber={payment.invoice_number}
                            previewMode={payment.status === "paid" || Boolean(payment.invoice_number) ? "invoice" : "draft"}
                            allowSend={payment.status === "paid"}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={ui.h2}>Sale items</h2>
          {canRefundItems ? (
            <span className={`text-xs ${ui.muted}`}>Select a row and enter qty or amount.</span>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className={`mt-3 ${ui.muted}`}>No items yet.</p>
        ) : canRefundItems ? (
          <PosRefundForm
            studioId={studioId}
            saleId={sale.id}
            idempotencyKey={`pos-refund-items:${sale.id}:${sale.updated_at}`}
            items={items.map((item) => ({
              id: item.id,
              line_number: item.line_number,
              item_type: item.item_type,
              item_name_snapshot: item.item_name_snapshot,
              item_currency_snapshot: item.item_currency_snapshot,
              quantity: Number(item.quantity),
              refunded_quantity: Number(item.refunded_quantity),
              total_amount: Number(item.total_amount),
              refunded_amount: Number(item.refunded_amount),
            }))}
          />
        ) : (
          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-stone-100 align-top last:border-b-0 dark:border-stone-900">
                  <td className="px-3 py-2">
                    <p>{item.item_name_snapshot}</p>
                    <p className={`text-xs capitalize ${ui.muted}`}>{item.item_type}</p>
                  </td>
                  <td className="px-3 py-2">{formatQty(Number(item.quantity))}</td>
                  <td className="px-3 py-2">{item.item_currency_snapshot} {Number(item.unit_price_amount).toFixed(2)}</td>
                  <td className="px-3 py-2">{item.item_currency_snapshot} {Number(item.discount_amount).toFixed(2)}</td>
                  <td className="px-3 py-2 font-medium">{item.item_currency_snapshot} {Number(item.total_amount).toFixed(2)}</td>
                  <td className="px-3 py-2">{item.item_currency_snapshot} {Number(item.refunded_amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
