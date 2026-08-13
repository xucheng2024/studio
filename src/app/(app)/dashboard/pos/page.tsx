import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { SyncHitpayPaymentButton } from "@/components/SyncHitpayPaymentButton";
import { PosProceedToPaymentForm } from "@/components/dashboard/PosProceedToPaymentForm";
import { proceedPosSaleToPaymentAction } from "@/app/(app)/dashboard/actions";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { listPosSalesForDashboard } from "@/lib/pos-sales-read";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

const STATUS_OPTIONS = [
  "all",
  "draft",
  "pending_payment",
  "paid",
  "partially_refunded",
  "refunded",
  "voided",
] as const;

type PosSaleStatusFilter = (typeof STATUS_OPTIONS)[number];

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

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    status?: PosSaleStatusFilter;
  }>;
};

export default async function PosSalesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      studioId: sp.studio_id ?? null,
      locationId: sp.location_id ?? null,
    },
    ["owner", "manager", "frontdesk"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to POS sales.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const admin = createAdminClient();
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");

  const normalizedLocations = locations ?? [];
  const effectiveLocationId =
    selectedLocationId && normalizedLocations.some((location) => location.id === selectedLocationId)
      ? selectedLocationId
      : null;

  const selectedStatus = STATUS_OPTIONS.includes((sp.status ?? "all") as PosSaleStatusFilter)
    ? (sp.status ?? "all")
    : "all";

  const salesResult = await listPosSalesForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    locationId: effectiveLocationId,
    status: selectedStatus === "all" ? undefined : selectedStatus,
    limit: 100,
  });

  if (!salesResult.ok) {
    if (salesResult.code === "forbidden") {
      return <p className={ui.muted}>You do not have scope to view POS sales for this studio/location.</p>;
    }
    return <p className={ui.error}>Could not load POS sales: {salesResult.message}</p>;
  }

  const { data: activeStudio } = await admin
    .from("studios")
    .select("public_slug")
    .eq("id", activeStudioId)
    .maybeSingle();
  const activeStudioSlug = activeStudio?.public_slug?.trim() ?? null;

  const latestPaymentIds = [...new Set(
    salesResult.sales
      .map((sale) => sale.payment_progress.latest_payment_id)
      .filter((value): value is string => Boolean(value)),
  )];
  const { data: latestPaymentsRaw } =
    latestPaymentIds.length > 0
      ? await admin
          .from("payments")
          .select("id, payment_method, gateway_payment_id")
          .in("id", latestPaymentIds)
      : { data: [] as const };
  const latestPaymentById = new Map(
    (latestPaymentsRaw ?? []).map((payment) => [payment.id, payment]),
  );

  const scopeQuery = new URLSearchParams();
  scopeQuery.set("studio_id", activeStudioId);
  if (effectiveLocationId) scopeQuery.set("location_id", effectiveLocationId);

  return (
    <div className="flex flex-col gap-6">
      <section className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={normalizedLocations}
          selectedStudioId={activeStudioId}
          selectedLocationId={effectiveLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
          allLabel="All POS locations"
        />

        <form method="get" className="flex min-w-52 flex-col gap-1.5">
          <input type="hidden" name="studio_id" value={activeStudioId} />
          {effectiveLocationId ? <input type="hidden" name="location_id" value={effectiveLocationId} /> : null}
          <span className={ui.label}>Status</span>
          <select name="status" className={ui.select} defaultValue={selectedStatus}>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{toStatusLabel(status)}</option>
            ))}
          </select>
          <button type="submit" className={ui.btnSecondarySm}>Apply</button>
        </form>
      </section>

      <section>
        <h1 className={ui.h1}>POS sales</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Unified POS draft/locked sales. Total {salesResult.totalCount} record{salesResult.totalCount === 1 ? "" : "s"}.
        </p>
      </section>

      {salesResult.sales.length === 0 ? (
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
                <th className="px-3 py-2">Payment progress</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {salesResult.sales.map((sale) => {
                const detailQuery = new URLSearchParams(scopeQuery.toString());
                const paymentQuery = new URLSearchParams(scopeQuery.toString());
                paymentQuery.set("source", "pos_sale");
                paymentQuery.set("q", sale.id);
                if (sale.payment_progress.latest_payment_id) {
                  paymentQuery.set("payment_id", sale.payment_progress.latest_payment_id);
                }
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
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
                          {toPaymentProgressLabel(sale.payment_progress.status)}
                        </span>
                        <span className={`text-[11px] ${ui.muted}`}>
                          {sale.payment_progress.payment_count > 0
                            ? `${sale.payment_progress.payment_count} payment record${sale.payment_progress.payment_count === 1 ? "" : "s"}`
                            : "No payment record yet"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{sale.customer_name ?? "Walk-in"}</td>
                    <td className="px-3 py-2">{sale.location_name ?? sale.location_id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{sale.currency} {Number(sale.total_amount).toFixed(2)}</td>
                    <td className="px-3 py-2">{formatLocalDateTime(sale.created_at)}</td>
                    <td className="px-3 py-2">
                      {sale.status === "draft" ? (
                        <PosProceedToPaymentForm
                          action={proceedPosSaleToPaymentAction}
                          studioId={activeStudioId}
                          locationId={effectiveLocationId}
                          saleId={sale.id}
                          idempotencyKey={`pos-lock:${sale.id}:${sale.updated_at}`}
                          ctaLabel="Proceed to payment"
                        />
                      ) : sale.status === "pending_payment" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <DashboardAppLink
                            href={`/dashboard/payments?${paymentQuery.toString()}`}
                            className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                          >
                            Go to payment
                          </DashboardAppLink>
                          {(() => {
                            const latestPaymentId = sale.payment_progress.latest_payment_id;
                            if (!activeStudioSlug || !latestPaymentId) return null;
                            const latestPayment = latestPaymentById.get(latestPaymentId);
                            if (!latestPayment) return null;
                            const method = String(latestPayment.payment_method ?? "").toLowerCase();
                            if (method !== "hitpay" || !latestPayment.gateway_payment_id) return null;
                            return <SyncHitpayPaymentButton paymentId={latestPaymentId} studioSlug={activeStudioSlug} compact />;
                          })()}
                        </div>
                      ) : (
                        <span className={`text-xs ${ui.muted}`}>Locked/closed</span>
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
