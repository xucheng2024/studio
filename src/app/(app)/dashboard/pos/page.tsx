import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { PosCashierWorkspace, type PosCashierSale, type PosCatalogItem } from "@/components/dashboard/PosCashierWorkspace";
import { PosSalesHistory, type PosSaleStatusFilter } from "@/components/dashboard/PosSalesHistory";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { openPosCashSessionAction } from "@/app/(app)/dashboard/actions";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { getPosSaleDetailForDashboard, listPosSalesForDashboard } from "@/lib/pos-sales-read";
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

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    status?: PosSaleStatusFilter;
    tab?: string;
    sale_id?: string;
    salon_customer_id?: string;
    salon_appointment_id?: string;
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
  const tab = sp.tab === "history" ? "history" : "sell";

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
  const locationNameForStatus =
    effectiveLocationId
      ? (normalizedLocations.find((location) => location.id === effectiveLocationId)?.name ?? "Current location")
      : null;

  const selectedStatus = STATUS_OPTIONS.includes((sp.status ?? "all") as PosSaleStatusFilter)
    ? (sp.status ?? "all")
    : "all";

  const [
    cashSessionResult,
    salesResult,
    studioResult,
    customersResult,
    serviceLocationsResult,
    servicesResult,
    productsResult,
    packagesResult,
    employeeLocationsResult,
    cashierEmployeeResult,
    saleDetailResult,
  ] = await Promise.all([
    effectiveLocationId
      ? admin
          .from("pos_cash_sessions")
          .select("id, opened_at, opening_float, status")
          .eq("studio_id", activeStudioId)
          .eq("location_id", effectiveLocationId)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as { id: string; opened_at: string; opening_float: number; status: string } | null }),
    listPosSalesForDashboard({
      userId: user.id,
      email: user.email ?? null,
      studioId: activeStudioId,
      locationId: effectiveLocationId,
      status: selectedStatus === "all" ? undefined : selectedStatus,
      limit: 100,
    }),
    admin.from("studios").select("public_slug").eq("id", activeStudioId).maybeSingle(),
    admin
      .from("salon_customers")
      .select("id, full_name, phone, email")
      .eq("studio_id", activeStudioId)
      .eq("status", "active")
      .is("merged_into_id", null)
      .order("updated_at", { ascending: false })
      .limit(200),
    effectiveLocationId
      ? admin
          .from("service_locations")
          .select("service_id, price_override, duration_override_minutes, is_enabled")
          .eq("studio_id", activeStudioId)
          .eq("location_id", effectiveLocationId)
          .eq("is_enabled", true)
      : Promise.resolve({ data: [] as Array<{ service_id: string; price_override: number | null; duration_override_minutes: number | null; is_enabled: boolean }> }),
    admin
      .from("studio_services")
      .select("id, title, price, is_active, default_duration_minutes")
      .eq("studio_id", activeStudioId)
      .eq("is_active", true)
      .order("title"),
    admin
      .from("shop_products")
      .select("id, title, price, stock_qty, is_active")
      .eq("studio_id", activeStudioId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    effectiveLocationId
      ? admin
          .from("packages")
          .select("id, name, price, credits, location_id, is_active")
          .eq("studio_id", activeStudioId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .or(`location_id.is.null,location_id.eq.${effectiveLocationId}`)
          .order("name")
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; price: number | null; credits: number | null; location_id: string | null; is_active: boolean }> }),
    effectiveLocationId
      ? admin
          .from("employee_locations")
          .select("employee_id, employees!inner(id, display_name, employment_status)")
          .eq("studio_id", activeStudioId)
          .eq("location_id", effectiveLocationId)
          .eq("is_active", true)
      : Promise.resolve({ data: [] as Array<{ employee_id: string; employees: { id: string; display_name: string; employment_status: string } | { id: string; display_name: string; employment_status: string }[] | null }> }),
    admin
      .from("employees")
      .select("id, display_name")
      .eq("studio_id", activeStudioId)
      .eq("user_id", user.id)
      .eq("employment_status", "active")
      .maybeSingle<{ id: string; display_name: string }>(),
    sp.sale_id
      ? getPosSaleDetailForDashboard({
          userId: user.id,
          email: user.email ?? null,
          studioId: activeStudioId,
          saleId: sp.sale_id,
          locationId: effectiveLocationId,
        })
      : Promise.resolve(null),
  ]);

  if (!salesResult.ok) {
    if (salesResult.code === "forbidden") {
      return <p className={ui.muted}>You do not have scope to view POS sales for this studio/location.</p>;
    }
    return <p className={ui.error}>Could not load POS sales: {salesResult.message}</p>;
  }

  const openCashSession = cashSessionResult.data;
  const activeStudioSlug = studioResult.data?.public_slug?.trim() ?? null;
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
  const sessionCashTotal = openCashSession
    ? salesResult.sales
        .filter((sale) => sale.status === "paid" && sale.created_at >= openCashSession.opened_at)
        .filter((sale) => {
          const latestPaymentId = sale.payment_progress.latest_payment_id;
          const method = latestPaymentId ? latestPaymentById.get(latestPaymentId)?.payment_method : null;
          return method === "cash";
        })
        .reduce((sum, sale) => sum + Number(sale.total_amount ?? 0), 0)
    : 0;

  const serviceLocationRows = serviceLocationsResult.data ?? [];
  const enabledServiceIds = new Map(serviceLocationRows.map((row) => [row.service_id, row]));
  const catalog: PosCatalogItem[] = [];
  for (const service of servicesResult.data ?? []) {
    const locationRow = enabledServiceIds.get(service.id);
    if (serviceLocationRows.length > 0 && !locationRow) continue;
    const price = Number(locationRow?.price_override ?? service.price ?? 0);
    const duration = Number(locationRow?.duration_override_minutes ?? service.default_duration_minutes ?? 0);
    catalog.push({
      type: "service",
      id: service.id,
      name: service.title ?? "Service",
      price: Number.isFinite(price) ? price : 0,
      currency: "SGD",
      meta: duration > 0 ? `${duration} min` : "",
      stockQty: null,
    });
  }
  for (const product of productsResult.data ?? []) {
    catalog.push({
      type: "product",
      id: product.id,
      name: product.title ?? "Product",
      price: Number(product.price ?? 0),
      currency: "SGD",
      meta: product.stock_qty == null ? "" : `Stock ${product.stock_qty}`,
      stockQty: product.stock_qty == null ? null : Number(product.stock_qty),
    });
  }
  for (const pkg of packagesResult.data ?? []) {
    catalog.push({
      type: "package",
      id: pkg.id,
      name: pkg.name ?? "Package",
      price: Number(pkg.price ?? 0),
      currency: "SGD",
      meta: pkg.credits != null ? `${pkg.credits} credits` : "",
      stockQty: null,
    });
  }

  const employees = (employeeLocationsResult.data ?? []).flatMap((row) => {
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    if (!employee || employee.employment_status !== "active") return [];
    return [{ id: employee.id, display_name: employee.display_name ?? "Staff" }];
  });
  const cashierEmployee = cashierEmployeeResult.data;
  if (cashierEmployee && !employees.some((employee) => employee.id === cashierEmployee.id)) {
    employees.unshift({ id: cashierEmployee.id, display_name: cashierEmployee.display_name ?? "Me" });
  }

  let initialSale: PosCashierSale | null = null;
  if (saleDetailResult && saleDetailResult.ok) {
    const { sale, items, payments } = saleDetailResult.detail;
    initialSale = {
      id: sale.id,
      status: sale.status,
      salonCustomerId: sale.salon_customer_id,
      customerName: sale.customer_name,
      totalAmount: Number(sale.total_amount),
      currency: sale.currency,
      receiptNumber: sale.receipt_number,
      items: items.map((item) => ({
        id: item.id,
        lineNumber: item.line_number,
        type: item.item_type,
        catalogId: item.service_id ?? item.product_id ?? item.package_id ?? item.id,
        name: item.item_name_snapshot,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price_amount),
        discount: Number(item.discount_amount),
        employeeId: item.employee_id,
        currency: item.item_currency_snapshot,
        appointmentId: item.salon_appointment_id,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        status: payment.status,
        payment_method: payment.payment_method,
        invoice_number: payment.invoice_number,
        invoice_status: payment.invoice_status,
        amount: Number(payment.amount),
      })),
    };
  }

  const scopeQuery = new URLSearchParams();
  scopeQuery.set("studio_id", activeStudioId);
  if (effectiveLocationId) scopeQuery.set("location_id", effectiveLocationId);
  const sellQuery = new URLSearchParams(scopeQuery.toString());
  const historyQuery = new URLSearchParams(scopeQuery.toString());
  historyQuery.set("tab", "history");
  if (selectedStatus !== "all") historyQuery.set("status", selectedStatus);

  return (
    <div className="flex flex-col gap-5">
      <section className={`${ui.card} flex flex-wrap items-end gap-3`}>
        <DashboardLocationFilter
          locations={normalizedLocations}
          selectedStudioId={activeStudioId}
          selectedLocationId={effectiveLocationId}
          allowAll={tab === "history" && canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
          allLabel="All POS locations"
        />
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/pos?${sellQuery.toString()}`} className={tab === "sell" ? ui.btnPrimarySm : ui.btnSecondarySm}>
            Sell
          </DashboardAppLink>
          <DashboardAppLink href={`/dashboard/pos?${historyQuery.toString()}`} className={tab === "history" ? ui.btnPrimarySm : ui.btnSecondarySm}>
            History
          </DashboardAppLink>
          <DashboardAppLink href={`/dashboard/pos/cash-sessions?${scopeQuery.toString()}`} className={ui.btnGhost}>
            Cash sessions
          </DashboardAppLink>
        </div>
      </section>

      {effectiveLocationId ? (
        openCashSession ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            <p className="font-medium">{locationNameForStatus} · session open since {formatLocalDateTime(openCashSession.opened_at)}</p>
            <p className="mt-0.5 text-xs sm:text-sm">
              Opening float: SGD {Number(openCashSession.opening_float ?? 0).toFixed(2)} · Cash collected this session: SGD {sessionCashTotal.toFixed(2)}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            <p className="font-medium">{locationNameForStatus} has no open cash session.</p>
            <ServerActionToastForm action={openPosCashSessionAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              <input type="hidden" name="location_id" value={effectiveLocationId} />
              <input type="hidden" name="idempotency_key" value={`pos-cash-session-open:${activeStudioId}:${effectiveLocationId}:${crypto.randomUUID()}`} />
              <label className="flex min-w-32 flex-col gap-1">
                <span className="text-xs">Opening float</span>
                <input name="opening_float" type="number" step="0.01" min="0" defaultValue="0.00" className={ui.input} />
              </label>
              <button type="submit" className={ui.btnPrimarySm}>Open cash session</button>
            </ServerActionToastForm>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200">
          Select a location to sell and track the cash session.
        </div>
      )}

      {tab === "history" ? (
        <PosSalesHistory
          studioId={activeStudioId}
          locationId={effectiveLocationId}
          selectedStatus={selectedStatus}
          sales={salesResult.sales}
          totalCount={salesResult.totalCount}
          studioSlug={activeStudioSlug}
          latestPaymentById={latestPaymentById}
        />
      ) : (
        <PosCashierWorkspace
          studioId={activeStudioId}
          locationId={effectiveLocationId}
          locationIds={normalizedLocations.map((location) => location.id)}
          locationName={locationNameForStatus}
          studioSlug={activeStudioSlug}
          catalog={catalog}
          customers={(customersResult.data ?? []).map((customer) => ({
            id: customer.id,
            full_name: customer.full_name ?? "Unnamed",
            phone: customer.phone ?? null,
            email: customer.email ?? null,
          }))}
          employees={employees}
          cashierEmployeeId={cashierEmployeeResult.data?.id ?? null}
          initialSale={initialSale}
          initialClientId={!sp.sale_id ? sp.salon_customer_id ?? null : null}
          initialAppointmentId={!sp.sale_id ? sp.salon_appointment_id ?? null : null}
        />
      )}
    </div>
  );
}
