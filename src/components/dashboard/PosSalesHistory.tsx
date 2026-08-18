import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SyncHitpayPaymentButton } from "@/components/SyncHitpayPaymentButton";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { voidPosSaleAction } from "@/app/(app)/dashboard/actions";
import { formatLocalDateTime } from "@/lib/date";
import type { PosSaleListRow } from "@/lib/pos-sales-read";
import { ui } from "@/lib/ui";

const STATUS_OPTIONS = [
  "all",
  "draft",
  "pending_payment",
  "paid",
  "partially_refunded",
  "refunded",
  "voided",
] as const;

export type PosSaleStatusFilter = (typeof STATUS_OPTIONS)[number];

function toStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function toPaymentProgressLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pending payment";
    case "paid":
      return "Paid";
    case "partially_refunded":
      return "Partially refunded";
    case "refunded":
      return "Refunded";
    case "failed_or_expired":
      return "Failed/expired";
    default:
      return "No payment";
  }
}

function statusChipClass(active: boolean) {
  return active
    ? ui.badge
    : "inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:text-stone-100";
}

export function PosSalesHistory(props: {
  studioId: string;
  locationId: string | null;
  selectedStatus: PosSaleStatusFilter;
  sales: PosSaleListRow[];
  totalCount: number;
  studioSlug: string | null;
  latestPaymentById: Map<string, { id: string; payment_method: string | null; gateway_payment_id: string | null }>;
}) {
  const scopeQuery = new URLSearchParams();
  scopeQuery.set("studio_id", props.studioId);
  scopeQuery.set("tab", "history");
  if (props.locationId) scopeQuery.set("location_id", props.locationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((status) => {
          const chipQuery = new URLSearchParams(scopeQuery.toString());
          if (status === "all") chipQuery.delete("status");
          else chipQuery.set("status", status);
          return (
            <DashboardAppLink
              key={status}
              href={`/dashboard/pos?${chipQuery.toString()}`}
              className={statusChipClass(props.selectedStatus === status)}
            >
              {status === "all" ? "All" : toStatusLabel(status)}
            </DashboardAppLink>
          );
        })}
      </div>

      <p className={ui.muted}>
        {props.totalCount} record{props.totalCount === 1 ? "" : "s"}.
      </p>

      {props.sales.length === 0 ? (
        <section className={ui.card}>
          <p className={ui.muted}>No POS sales in this scope.</p>
        </section>
      ) : (
        <section className={`${ui.card} overflow-x-auto`}>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="px-3 py-2">Sale</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {props.sales.map((sale) => {
                const detailQuery = new URLSearchParams();
                detailQuery.set("studio_id", props.studioId);
                if (props.locationId) detailQuery.set("location_id", props.locationId);
                const continueQuery = new URLSearchParams(detailQuery.toString());
                continueQuery.set("tab", "sell");
                continueQuery.set("sale_id", sale.id);
                return (
                  <tr key={sale.id} className="border-b border-stone-100 align-top last:border-b-0 dark:border-stone-900">
                    <td className="px-3 py-2">
                      <DashboardAppLink
                        href={`/dashboard/pos/${sale.id}?${detailQuery.toString()}`}
                        className="font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                      >
                        {sale.sale_number ?? sale.id.slice(0, 8)}
                      </DashboardAppLink>
                    </td>
                    <td className="px-3 py-2 capitalize">{toStatusLabel(sale.status)}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
                        {toPaymentProgressLabel(sale.payment_progress.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{sale.customer_name ?? "Walk-in"}</td>
                    <td className="px-3 py-2">{sale.currency} {Number(sale.total_amount).toFixed(2)}</td>
                    <td className="px-3 py-2">{formatLocalDateTime(sale.created_at)}</td>
                    <td className="px-3 py-2">
                      {sale.status === "draft" || sale.status === "pending_payment" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <DashboardAppLink href={`/dashboard/pos?${continueQuery.toString()}`} className={ui.btnPrimarySm}>
                            Continue
                          </DashboardAppLink>
                          {(() => {
                            const latestPaymentId = sale.payment_progress.latest_payment_id;
                            if (!props.studioSlug || !latestPaymentId) return null;
                            const latestPayment = props.latestPaymentById.get(latestPaymentId);
                            if (!latestPayment) return null;
                            const method = String(latestPayment.payment_method ?? "").toLowerCase();
                            if (method !== "hitpay" || !latestPayment.gateway_payment_id) return null;
                            return <SyncHitpayPaymentButton paymentId={latestPaymentId} studioSlug={props.studioSlug} compact />;
                          })()}
                          <ToastConfirmForm
                            action={voidPosSaleAction}
                            confirmMessage="Void this sale?"
                            confirmLabel="Void"
                            pendingLabel="Voiding…"
                          >
                            <input type="hidden" name="studio_id" value={props.studioId} />
                            <input type="hidden" name="sale_id" value={sale.id} />
                            <input type="hidden" name="reason" value="voided_from_pos_list" />
                            <input type="hidden" name="idempotency_key" value={`pos-void-list:${sale.id}:${sale.updated_at}`} />
                            <button type="submit" className={ui.btnDangerSm}>Void</button>
                          </ToastConfirmForm>
                        </div>
                      ) : (
                        <DashboardAppLink
                          href={`/dashboard/pos/${sale.id}?${detailQuery.toString()}`}
                          className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                        >
                          Open
                        </DashboardAppLink>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
