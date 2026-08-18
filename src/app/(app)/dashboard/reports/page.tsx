import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SalonReportingFacts } from "@/components/dashboard/SalonReportingFacts";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import {
  fetchDeferredValueDetailRows,
  filterDeferredRowsByKeyword,
  groupDeferredByCustomer,
  groupDeferredByPackage,
} from "@/lib/deferred-value-report";
import {
  computeRevenueSummary,
  revenueEffectiveTimestamp,
  revenueByDayAndOrderType,
  revenueByOrderType,
  type RevenuePaymentRow,
} from "@/lib/revenue-summary";
import { getSalonReportingFacts } from "@/lib/salon-reporting";
import { PAYMENT_SALES_CHANNEL_FILTER_OPTIONS, PAYMENT_SOURCE_FILTER_OPTIONS } from "@/lib/payment-filter-options";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { TrendingUp, RefreshCcw, DollarSign, CalendarRange, Package, Repeat, ShoppingBag, PlaySquare, BriefcaseBusiness } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    date_from?: string;
    date_to?: string;
    source?: string;
    sales_channel?: string;
    employee_id?: string;
    service_id?: string;
    deferred_view?: string;
    deferred_customer_id?: string;
    deferred_package_id?: string;
    deferred_q?: string;
  }>;
};

type DeferredValueSummaryRow = {
  studio_id: string;
  location_id: string | null;
  as_of: string;
  currency: string;
  customer_count: number;
  package_count: number;
  row_count: number;
  total_remaining_credits: number;
  total_deferred_value: number;
};

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: localISODate(start),
    to: localISODate(end),
  };
}

export default async function ReportsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const requestedLocationId =
    sp.location_id && sp.location_id !== "__unassigned" ? sp.location_id : null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: requestedLocationId,
  }, ["owner", "manager"]);
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const allowsStudioLevelLocationFilter = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const locationFilter =
    sp.location_id === "__unassigned" && allowsStudioLevelLocationFilter
      ? "__unassigned"
      : selectedLocationId;
  const bounds = monthBounds();
  const dateFrom = sp.date_from ?? bounds.from;
  const dateTo = sp.date_to ?? bounds.to;
  const source = sp.source ?? "";
  const salesChannel = sp.sales_channel ?? "";
  const employeeId = sp.employee_id ?? "";
  const serviceId = sp.service_id ?? "";
  const deferredView = sp.deferred_view === "package" ? "package" : "customer";
  const deferredCustomerId = sp.deferred_customer_id ?? "";
  const deferredPackageId = sp.deferred_package_id ?? "";
  const deferredKeyword = sp.deferred_q?.trim() ?? "";
  const fromIso = dayRangeStartIso(dateFrom);
  const toIso = dayRangeEndExclusiveIso(dateTo);
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");
  const [{ data: reportEmployees }, { data: reportServices }] = await Promise.all([
    admin.from("employees").select("id, display_name").eq("studio_id", activeStudioId).order("display_name"),
    admin.from("studio_services").select("id, title").eq("studio_id", activeStudioId).eq("is_active", true).order("title"),
  ]);
  let salonFacts = null as Awaited<ReturnType<typeof getSalonReportingFacts>> | null;
  try {
    salonFacts = await getSalonReportingFacts({
      studioId: activeStudioId,
      dateFrom,
      dateTo,
      locationId: locationFilter === "__unassigned" ? null : locationFilter,
      unassigned: locationFilter === "__unassigned",
      employeeId: employeeId || null,
      serviceId: serviceId || null,
    });
  } catch (error) {
    console.error("[RPT-01] salon facts unavailable", { message: error instanceof Error ? error.message : String(error) });
  }
  const locationLabel =
    locationFilter === "__unassigned"
      ? "Studio-level / unassigned"
      : locationFilter
        ? (locations ?? []).find((location) => location.id === locationFilter)?.name ?? "Selected location"
        : "All locations";

  let revenueQuery = admin
    .from("payments")
    .select("id, amount, type, payment_method, status, created_at, paid_at, verified_at, refunded_at, location_id, source, booking_id, event_booking_id, sales_channel")
    .in("studio_id", studioIds)
    .in("status", ["paid", "refunded"])
    .order("verified_at", { ascending: false, nullsFirst: false })
    .limit(5000);
  if (locationFilter === "__unassigned") revenueQuery = revenueQuery.is("location_id", null);
  else if (locationFilter) revenueQuery = revenueQuery.eq("location_id", locationFilter);
  if (source) revenueQuery = revenueQuery.eq("source", source);
  if (salesChannel) revenueQuery = revenueQuery.eq("sales_channel", salesChannel);
  if (fromIso && toIso) {
    revenueQuery = revenueQuery.or(
      `and(status.eq.paid,verified_at.gte.${fromIso},verified_at.lt.${toIso}),and(status.eq.paid,verified_at.is.null,paid_at.gte.${fromIso},paid_at.lt.${toIso}),and(status.eq.paid,verified_at.is.null,paid_at.is.null,created_at.gte.${fromIso},created_at.lt.${toIso}),and(status.eq.refunded,refunded_at.gte.${fromIso},refunded_at.lt.${toIso})`,
    );
  } else if (fromIso) {
    revenueQuery = revenueQuery.or(
      `and(status.eq.paid,verified_at.gte.${fromIso}),and(status.eq.paid,verified_at.is.null,paid_at.gte.${fromIso}),and(status.eq.paid,verified_at.is.null,paid_at.is.null,created_at.gte.${fromIso}),and(status.eq.refunded,refunded_at.gte.${fromIso})`,
    );
  } else if (toIso) {
    revenueQuery = revenueQuery.or(
      `and(status.eq.paid,verified_at.lt.${toIso}),and(status.eq.paid,verified_at.is.null,paid_at.lt.${toIso}),and(status.eq.paid,verified_at.is.null,paid_at.is.null,created_at.lt.${toIso}),and(status.eq.refunded,refunded_at.lt.${toIso})`,
    );
  }

  const { data: revenuePaymentsRaw } = await revenueQuery;
  const revenuePayments = ((revenuePaymentsRaw ?? []) as RevenuePaymentRow[]).filter((row) => {
    const effectiveAt = revenueEffectiveTimestamp(row);
    if (!effectiveAt) return false;
    if (fromIso && effectiveAt < fromIso) return false;
    if (toIso && effectiveAt >= toIso) return false;
    return true;
  });
  const summary = computeRevenueSummary(revenuePayments);
  const byType = revenueByOrderType(revenuePayments);
  const byDay = revenueByDayAndOrderType(revenuePayments);

  const deferredLocationFilter = locationFilter === "__unassigned" ? null : locationFilter;
  const { data: deferredSummaryRaw } = await admin.rpc("get_pkg01_deferred_value_summary", {
    p_studio_id: activeStudioId,
    p_location_id: deferredLocationFilter,
    p_customer_id: null,
    p_package_id: null,
    p_as_of: new Date().toISOString(),
    p_refresh_conflicts: false,
    p_actor_id: user.id,
  });
  const deferredSummaryRows = (deferredSummaryRaw ?? []) as DeferredValueSummaryRow[];
  const deferredSummary = deferredSummaryRows.reduce(
    (acc, row) => {
      acc.customerCount += Number(row.customer_count ?? 0);
      acc.packageCount += Number(row.package_count ?? 0);
      acc.rowCount += Number(row.row_count ?? 0);
      acc.totalCredits += Number(row.total_remaining_credits ?? 0);
      acc.totalValue += Number(row.total_deferred_value ?? 0);
      return acc;
    },
    {
      customerCount: 0,
      packageCount: 0,
      rowCount: 0,
      totalCredits: 0,
      totalValue: 0,
    },
  );
  const deferredCurrency = deferredSummaryRows.length === 1
    ? deferredSummaryRows[0].currency
    : deferredSummaryRows.length > 1
      ? "MIXED"
      : "SGD";

  const deferredRows = await fetchDeferredValueDetailRows({
    studioId: activeStudioId,
    locationId: locationFilter,
    actorId: user.id,
    limit: 5000,
  });

  const deferredRowsKeywordFiltered = filterDeferredRowsByKeyword(deferredRows, deferredKeyword);
  const deferredRowsFiltered = deferredRowsKeywordFiltered.filter((row) => {
    if (deferredCustomerId && row.customer_id !== deferredCustomerId) return false;
    if (deferredPackageId && row.package_id !== deferredPackageId) return false;
    return true;
  });

  const preferredClientPackageByCustomer = new Map<string, string>();
  const preferredClientPackageByPackage = new Map<string, string>();
  const bestValueByCustomer = new Map<string, number>();
  const bestValueByPackage = new Map<string, number>();

  for (const row of deferredRowsFiltered) {
    const currentCustomerBest = bestValueByCustomer.get(row.customer_id) ?? Number.NEGATIVE_INFINITY;
    if (row.deferred_value >= currentCustomerBest) {
      bestValueByCustomer.set(row.customer_id, row.deferred_value);
      preferredClientPackageByCustomer.set(row.customer_id, row.client_package_id);
    }

    const currentPackageBest = bestValueByPackage.get(row.package_id) ?? Number.NEGATIVE_INFINITY;
    if (row.deferred_value >= currentPackageBest) {
      bestValueByPackage.set(row.package_id, row.deferred_value);
      preferredClientPackageByPackage.set(row.package_id, row.client_package_id);
    }
  }

  const deferredCustomerRows = groupDeferredByCustomer(deferredRowsFiltered).slice(0, 200);
  const deferredPackageRows = groupDeferredByPackage(deferredRowsFiltered).slice(0, 200);

  const deferredCustomerOptions = [...new Map(
    deferredRows.map((row) => [row.customer_id, { id: row.customer_id, name: row.customer_name }]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const deferredPackageOptions = [...new Map(
    deferredRows.map((row) => [row.package_id, { id: row.package_id, name: row.package_name }]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  const commonReportParams = new URLSearchParams();
  if (activeStudioId) commonReportParams.set("studio_id", activeStudioId);
  if (locationFilter) commonReportParams.set("location_id", locationFilter);
  if (dateFrom) commonReportParams.set("date_from", dateFrom);
  if (dateTo) commonReportParams.set("date_to", dateTo);
  if (source) commonReportParams.set("source", source);
  if (salesChannel) commonReportParams.set("sales_channel", salesChannel);

  const deferredCustomerDetailParams = new URLSearchParams(commonReportParams);
  deferredCustomerDetailParams.set("deferred_view", "customer");
  const deferredPackageDetailParams = new URLSearchParams(commonReportParams);
  deferredPackageDetailParams.set("deferred_view", "package");

  const deferredExportParams = new URLSearchParams(commonReportParams);
  deferredExportParams.set("deferred_view", deferredView);
  if (deferredCustomerId) deferredExportParams.set("deferred_customer_id", deferredCustomerId);
  if (deferredPackageId) deferredExportParams.set("deferred_package_id", deferredPackageId);
  if (deferredKeyword) deferredExportParams.set("deferred_q", deferredKeyword);

  const deferredResetParams = new URLSearchParams(commonReportParams);
  deferredResetParams.set("deferred_view", deferredView);

  const approvalsBaseParams = new URLSearchParams();
  approvalsBaseParams.set("studio_id", activeStudioId);
  if (locationFilter && locationFilter !== "__unassigned") {
    approvalsBaseParams.set("location_id", locationFilter);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Reports</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {locationLabel} · Revenue uses{" "}
          <code className={ui.code}>verified_at</code> or <code className={ui.code}>paid_at</code> for paid records and{" "}
          <code className={ui.code}>refunded_at</code> for refunds, grouped by your local calendar day.
        </p>
      </div>

      <div className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-wrap gap-3">
          <DashboardLocationFilter
            locations={locations ?? []}
            selectedStudioId={activeStudioId}
            selectedLocationId={locationFilter}
            allowAll={allowsStudioLevelLocationFilter}
            accessibleLocationIds={accessibleLocationIds}
            unassignedLabel={allowsStudioLevelLocationFilter ? "Studio-level / Unassigned" : undefined}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "This month", from: bounds.from, to: bounds.to },
            {
              label: "Last 30 days",
              from: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                return localISODate(d);
              })(),
              to: localISODate(),
            },
            {
              label: "Last month",
              from: (() => {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - 1);
                return localISODate(d);
              })(),
              to: (() => {
                const d = new Date();
                d.setDate(0);
                return localISODate(d);
              })(),
            },
            {
              label: "Last 90 days",
              from: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 90);
                return localISODate(d);
              })(),
              to: localISODate(),
            },
          ].map(({ label, from, to }) => {
            const isActive = dateFrom === from && dateTo === to;
            const params = new URLSearchParams();
            if (activeStudioId) params.set("studio_id", activeStudioId);
            if (locationFilter) params.set("location_id", locationFilter);
            if (source) params.set("source", source);
            if (salesChannel) params.set("sales_channel", salesChannel);
            if (employeeId) params.set("employee_id", employeeId);
            if (serviceId) params.set("service_id", serviceId);
            params.set("date_from", from);
            params.set("date_to", to);
            return (
              <a
                key={label}
                href={`?${params.toString()}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] inline-flex items-center ${
                  isActive
                    ? "border-teal-400 bg-teal-50 text-teal-800 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>

        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {activeStudioId ? <input type="hidden" name="studio_id" value={activeStudioId} /> : null}
          {locationFilter ? <input type="hidden" name="location_id" value={locationFilter} /> : null}
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3 lg:grid-cols-6">
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>From</span>
              <input type="date" name="date_from" defaultValue={dateFrom} className={`${ui.input} whitespace-nowrap`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>To</span>
              <input type="date" name="date_to" defaultValue={dateTo} className={`${ui.input} whitespace-nowrap`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>Order type</span>
              <select name="source" defaultValue={source} className={ui.select}>
                <option value="">All</option>
                {PAYMENT_SOURCE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>Channel</span>
              <select name="sales_channel" defaultValue={salesChannel} className={ui.select}>
                <option value="">All</option>
                {PAYMENT_SALES_CHANNEL_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>Employee</span>
              <select name="employee_id" defaultValue={employeeId} className={ui.select}>
                <option value="">All</option>
                {(reportEmployees ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.display_name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>Service</span>
              <select name="service_id" defaultValue={serviceId} className={ui.select}>
                <option value="">All</option>
                {(reportServices ?? []).map((service) => (
                  <option key={service.id} value={service.id}>{service.title}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className={`${ui.btnPrimarySm} w-full sm:w-auto`}>Apply</button>
        </form>
      </div>

      {salonFacts ? <SalonReportingFacts facts={salonFacts} /> : <p className={ui.muted}>Salon facts are unavailable until the reporting migration is applied.</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
            <DollarSign size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Gross revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-teal-700 dark:text-teal-300 sm:text-2xl">
              ${summary.gross.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            <RefreshCcw size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Refunds</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-blue-800 dark:text-blue-200 sm:text-2xl">
              ${summary.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <TrendingUp size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Net revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${summary.net.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <Package size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Deferred value</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-violet-800 dark:text-violet-200 sm:text-2xl">
              {deferredCurrency} {deferredSummary.totalValue.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              {deferredSummary.totalCredits} unconsumed credits · {deferredSummary.customerCount} customers · {deferredSummary.packageCount} package types · {deferredSummary.rowCount} package rows
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <DashboardAppLink href={`/dashboard/reports?${deferredCustomerDetailParams.toString()}`} className={ui.btnSecondarySm}>
                Customer details
              </DashboardAppLink>
              <DashboardAppLink href={`/dashboard/reports?${deferredPackageDetailParams.toString()}`} className={ui.btnSecondarySm}>
                Package details
              </DashboardAppLink>
            </div>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className={`${ui.h2} text-base`}>Deferred drill-down</h2>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              View by {deferredView === "package" ? "package" : "customer"}, then drill into the opposite detail and export with the same filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardAppLink href={`/dashboard/reports?${deferredCustomerDetailParams.toString()}`} className={ui.btnSecondarySm}>
              By customer
            </DashboardAppLink>
            <DashboardAppLink href={`/dashboard/reports?${deferredPackageDetailParams.toString()}`} className={ui.btnSecondarySm}>
              By package
            </DashboardAppLink>
            <a href={`/api/reports/deferred/export?${deferredExportParams.toString()}`} className={ui.btnSecondarySm}>
              Export CSV
            </a>
            <a href={`/api/reports/deferred/export?${deferredExportParams.toString()}&format=tsv`} className={ui.btnSecondarySm}>
              Export TSV
            </a>
            <a href={`/api/reports/deferred/export?${deferredExportParams.toString()}&format=xlsx`} className={ui.btnSecondarySm}>
              Export XLSX
            </a>
            <a href={`/api/reports/deferred/export?${deferredExportParams.toString()}&format=xml`} className={ui.btnSecondarySm}>
              Export XML
            </a>
          </div>
        </div>

        <form method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {activeStudioId ? <input type="hidden" name="studio_id" value={activeStudioId} /> : null}
          {locationFilter ? <input type="hidden" name="location_id" value={locationFilter} /> : null}
          <input type="hidden" name="date_from" value={dateFrom} />
          <input type="hidden" name="date_to" value={dateTo} />
          {source ? <input type="hidden" name="source" value={source} /> : null}
          {salesChannel ? <input type="hidden" name="sales_channel" value={salesChannel} /> : null}
          <input type="hidden" name="deferred_view" value={deferredView} />

          <label className="flex min-w-48 flex-col gap-1.5">
            <span className={ui.label}>Keyword</span>
            <input name="deferred_q" defaultValue={deferredKeyword} className={ui.input} placeholder="Customer / package / email" />
          </label>

          <label className="flex min-w-48 flex-col gap-1.5">
            <span className={ui.label}>Customer</span>
            <select name="deferred_customer_id" defaultValue={deferredCustomerId} className={ui.select}>
              <option value="">All</option>
              {deferredCustomerOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          <label className="flex min-w-48 flex-col gap-1.5">
            <span className={ui.label}>Package</span>
            <select name="deferred_package_id" defaultValue={deferredPackageId} className={ui.select}>
              <option value="">All</option>
              {deferredPackageOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          <button type="submit" className={`${ui.btnPrimarySm} w-full sm:w-auto`}>Apply</button>
          <a href={`/dashboard/reports?${deferredResetParams.toString()}`} className={`${ui.btnGhost} w-full sm:w-auto`}>Reset</a>
        </form>

        <div className="mt-4 overflow-x-auto">
          {deferredView === "customer" ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                  <th className="py-2 pr-4 font-medium">Customer</th>
                  <th className="py-2 pr-4 font-medium">Packages</th>
                  <th className="py-2 pr-4 font-medium">Rows</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Deferred value</th>
                  <th className="py-2 font-medium">Drill</th>
                </tr>
              </thead>
              <tbody>
                {deferredCustomerRows.map((row) => {
                  const customerParams = new URLSearchParams(commonReportParams);
                  customerParams.set("deferred_view", "package");
                  customerParams.set("deferred_customer_id", row.customer_id);
                  if (deferredKeyword) customerParams.set("deferred_q", deferredKeyword);
                  if (deferredPackageId) customerParams.set("deferred_package_id", deferredPackageId);

                  const customerDetailParams = new URLSearchParams();
                  customerDetailParams.set("studio_id", activeStudioId);
                  if (locationFilter && locationFilter !== "__unassigned") {
                    customerDetailParams.set("location_id", locationFilter);
                  }

                  const preferredClientPackageId = preferredClientPackageByCustomer.get(row.customer_id) ?? "";
                  const approvalsParams = new URLSearchParams(approvalsBaseParams);
                  if (preferredClientPackageId) approvalsParams.set("client_package_id", preferredClientPackageId);
                  const approvalsHref = `/dashboard/packages/approvals?${approvalsParams.toString()}`;

                  return (
                    <tr key={row.customer_id} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                      <td className="py-2.5 pr-4 text-stone-800 dark:text-stone-200">
                        <DashboardAppLink href={`/dashboard/clients/${row.customer_id}?${customerDetailParams.toString()}`} className={ui.linkMuted}>
                          {row.customer_name}
                        </DashboardAppLink>
                        {row.customer_email ? <div className={`text-xs ${ui.muted}`}>{row.customer_email}</div> : null}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.package_count}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.row_count}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.remaining_credits}</td>
                      <td className="py-2.5 pr-4 tabular-nums font-semibold text-violet-700 dark:text-violet-300">{row.deferred_value.toFixed(2)}</td>
                      <td className="py-2.5">
                        <div className="flex flex-col gap-1">
                          <DashboardAppLink href={`/dashboard/reports?${customerParams.toString()}`} className={ui.linkMuted}>
                            Package details
                          </DashboardAppLink>
                          <DashboardAppLink href={approvalsHref} className={ui.linkMuted}>
                            Adjust via approval
                          </DashboardAppLink>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                  <th className="py-2 pr-4 font-medium">Package</th>
                  <th className="py-2 pr-4 font-medium">Customers</th>
                  <th className="py-2 pr-4 font-medium">Rows</th>
                  <th className="py-2 pr-4 font-medium">Credits</th>
                  <th className="py-2 pr-4 font-medium">Deferred value</th>
                  <th className="py-2 font-medium">Drill</th>
                </tr>
              </thead>
              <tbody>
                {deferredPackageRows.map((row) => {
                  const packageParams = new URLSearchParams(commonReportParams);
                  packageParams.set("deferred_view", "customer");
                  packageParams.set("deferred_package_id", row.package_id);
                  if (deferredKeyword) packageParams.set("deferred_q", deferredKeyword);
                  if (deferredCustomerId) packageParams.set("deferred_customer_id", deferredCustomerId);

                  const preferredClientPackageId = preferredClientPackageByPackage.get(row.package_id) ?? "";
                  const approvalsParams = new URLSearchParams(approvalsBaseParams);
                  if (preferredClientPackageId) approvalsParams.set("client_package_id", preferredClientPackageId);
                  const approvalsHref = `/dashboard/packages/approvals?${approvalsParams.toString()}`;

                  return (
                    <tr key={row.package_id} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                      <td className="py-2.5 pr-4 text-stone-800 dark:text-stone-200">
                        {row.package_name}
                        <div className={`text-xs ${ui.muted}`}>{row.location_name ?? "Studio-level / unassigned"}</div>
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.customer_count}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.row_count}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">{row.remaining_credits}</td>
                      <td className="py-2.5 pr-4 tabular-nums font-semibold text-violet-700 dark:text-violet-300">{row.deferred_value.toFixed(2)}</td>
                      <td className="py-2.5">
                        <div className="flex flex-col gap-1">
                          <DashboardAppLink href={`/dashboard/reports?${packageParams.toString()}`} className={ui.linkMuted}>
                            Customer details
                          </DashboardAppLink>
                          <DashboardAppLink href={approvalsHref} className={ui.linkMuted}>
                            Adjust via approval
                          </DashboardAppLink>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {deferredRowsFiltered.length > 200 ? (
            <p className={`mt-3 text-xs ${ui.muted}`}>
              Showing first 200 grouped rows. Export CSV for full filtered results.
            </p>
          ) : null}
          {!deferredRowsFiltered.length ? (
            <p className={`mt-3 text-sm ${ui.muted}`}>No deferred rows matched your current filters.</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
            <CalendarRange size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Session revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.session.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.session.gross.toFixed(2)} · Ref ${byType.session.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <TrendingUp size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Event revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.event.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.event.gross.toFixed(2)} · Ref ${byType.event.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            <Package size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Package revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.package.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.package.gross.toFixed(2)} · Ref ${byType.package.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
            <Repeat size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Membership revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.membership.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.membership.gross.toFixed(2)} · Ref ${byType.membership.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <PlaySquare size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Member zone revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.memberZone.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.memberZone.gross.toFixed(2)} · Ref ${byType.memberZone.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            <ShoppingBag size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Shop revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.shop.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.shop.gross.toFixed(2)} · Ref ${byType.shop.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
            <BriefcaseBusiness size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Service revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${byType.service.net.toFixed(2)}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              Gross ${byType.service.gross.toFixed(2)} · Ref ${byType.service.refunds.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Revenue by day</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>
          Each row shows net revenue split by session, event, package, membership, member zone, shop, and service, plus total gross, refunds, and net.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="py-2 pr-4 font-medium">Day</th>
                <th className="py-2 pr-4 font-medium">Session</th>
                <th className="py-2 pr-4 font-medium">Event</th>
                <th className="py-2 pr-4 font-medium">Package</th>
                <th className="py-2 pr-4 font-medium">Membership</th>
                <th className="py-2 pr-4 font-medium">Member zone</th>
                <th className="py-2 pr-4 font-medium">Shop</th>
                <th className="py-2 pr-4 font-medium">Service</th>
                <th className="py-2 pr-4 font-medium">Gross</th>
                <th className="py-2 pr-4 font-medium">Refunds</th>
                <th className="py-2 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((row) => (
                <tr key={row.day} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                  <td className="py-2.5 pr-4 font-medium tabular-nums text-stone-800 dark:text-stone-200">{row.day}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.sessionNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.eventNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.packageNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.membershipNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.memberZoneNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.shopNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-600 dark:text-stone-300">${row.serviceNet.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-500 dark:text-stone-400">${row.gross.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-stone-500 dark:text-stone-400">-${row.refunds.toFixed(2)}</td>
                  <td className="py-2.5 font-semibold tabular-nums text-stone-900 dark:text-stone-100">${row.net.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!byDay.length ? <p className={`mt-4 text-sm ${ui.muted}`}>No payments in this range.</p> : null}
      </div>
    </div>
  );
}
