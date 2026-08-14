import { NextResponse } from "next/server";
import { localISODate } from "@/lib/date";
import {
  fetchDeferredValueDetailRows,
  filterDeferredRowsByKeyword,
  groupDeferredByCustomer,
  groupDeferredByPackage,
} from "@/lib/deferred-value-report";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { applyExportCap, buildExportCapHeaders, resolveExportCap, type ExportFormat } from "@/lib/export-cap";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { buildDeferredExportPayload } from "@/lib/reports-deferred-export";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioId = url.searchParams.get("studio_id");
  const rawLocationId = url.searchParams.get("location_id");
  const requestedLocationId =
    rawLocationId && rawLocationId !== "__unassigned" ? rawLocationId : null;

  const deferredView = url.searchParams.get("deferred_view") === "package" ? "package" : "customer";
  const requestedFormat = (url.searchParams.get("format") ?? "").toLowerCase();
  const format: ExportFormat = requestedFormat === "tsv" || requestedFormat === "xlsx" || requestedFormat === "xml"
    ? requestedFormat
    : "csv";
  const { exportCap } = resolveExportCap(format);
  const deferredCustomerId = url.searchParams.get("deferred_customer_id")?.trim() ?? "";
  const deferredPackageId = url.searchParams.get("deferred_package_id")?.trim() ?? "";
  const deferredKeyword = url.searchParams.get("deferred_q")?.trim() ?? "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dashboardScope = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId,
      locationId: requestedLocationId,
    },
    ["owner", "manager"],
  );

  if (dashboardScope.studioIds.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const activeStudioId = dashboardScope.selectedStudioId ?? dashboardScope.studioIds[0];
  if (studioId && activeStudioId !== studioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (rawLocationId && rawLocationId !== "__unassigned" && dashboardScope.selectedLocationId !== rawLocationId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (rawLocationId === "__unassigned" && !hasStudioGlobalLocationAccess(dashboardScope.ctx, activeStudioId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const locationFilter =
    rawLocationId === "__unassigned" ? "__unassigned" : dashboardScope.selectedLocationId;

  const deferredRows = await fetchDeferredValueDetailRows({
    studioId: activeStudioId,
    locationId: locationFilter,
    customerId: deferredCustomerId || null,
    packageId: deferredPackageId || null,
    actorId: user.id,
    limit: exportCap + 1,
  });
  const filteredRows = filterDeferredRowsByKeyword(deferredRows, deferredKeyword);
  const capped = applyExportCap(filteredRows, exportCap);

  const headers = deferredView === "customer"
    ? [
        "customer_id",
        "customer_name",
        "customer_email",
        "customer_phone",
        "package_count",
        "row_count",
        "remaining_credits",
        "total_deferred_value",
        "currencies",
      ]
    : [
        "package_id",
        "package_name",
        "location_id",
        "location_name",
        "customer_count",
        "row_count",
        "remaining_credits",
        "total_deferred_value",
        "currencies",
      ];

  const bodyRows = deferredView === "customer"
    ? groupDeferredByCustomer(capped.rows).map((row) => [
        row.customer_id,
        row.customer_name,
        row.customer_email ?? "",
        row.customer_phone ?? "",
        row.package_count,
        row.row_count,
        row.remaining_credits,
        row.deferred_value.toFixed(2),
        row.currencies.join("|"),
      ])
    : groupDeferredByPackage(capped.rows).map((row) => [
        row.package_id,
        row.package_name,
        row.location_id ?? "",
        row.location_name ?? "",
        row.customer_count,
        row.row_count,
        row.remaining_credits,
        row.deferred_value.toFixed(2),
        row.currencies.join("|"),
      ]);

  const payload = await buildDeferredExportPayload({
    format,
    headers,
    rows: bodyRows,
  });
  const filename = `reports-deferred-${deferredView}-${localISODate()}.${format}`;
  const responseBody = typeof payload.body === "string"
    ? payload.body
    : new Blob([new Uint8Array(Array.from(payload.body))]);

  return new NextResponse(responseBody, {
    headers: {
      "content-type": payload.contentType,
      "content-disposition": `attachment; filename=\"${filename}\"`,
      ...buildExportCapHeaders({
        wasCapped: capped.wasCapped,
        exportCap: capped.exportCap,
        rowCount: bodyRows.length,
      }),
    },
  });
}
