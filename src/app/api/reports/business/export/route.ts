import { NextResponse } from "next/server";
import { localISODate } from "@/lib/date";
import {
  buildCustomerExportTable,
  buildPackageExportTable,
  buildSaleExportTable,
} from "@/lib/business-export";
import { exportHeadersAreSafe, parseBusinessExportKind } from "@/lib/business-export-model";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { applyExportCap, buildExportCapHeaders, parseExportFormat, resolveExportCap } from "@/lib/export-cap";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { buildDeferredExportPayload } from "@/lib/reports-deferred-export";
import { writeStrongAudit } from "@/lib/strong-audit";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = parseBusinessExportKind(url.searchParams.get("kind"));
  const format = parseExportFormat(url.searchParams.get("format"));
  const studioId = url.searchParams.get("studio_id");
  const rawLocationId = url.searchParams.get("location_id");
  const requestedLocationId =
    rawLocationId && rawLocationId !== "__unassigned" ? rawLocationId : null;

  if (!kind) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const roles = kind === "customers"
    ? ["owner", "manager", "frontdesk", "instructor"] as const
    : kind === "packages"
      ? ["owner", "manager", "frontdesk"] as const
      : ["owner", "manager"] as const;

  const dashboardScope = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId,
      locationId: requestedLocationId,
    },
    [...roles],
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
  const { exportCap } = resolveExportCap(format);
  const actorRole = dashboardScope.ctx.isSuperAdmin
    ? "owner"
    : roles.find((role) =>
      dashboardScope.ctx.memberships.some((membership) => membership.studio_id === activeStudioId && membership.role === role),
    ) ?? roles[0];

  let table: { headers: string[]; rows: Array<Array<string | number>> };
  if (kind === "customers") {
    const result = await buildCustomerExportTable({
      userId: user.id,
      email: user.email ?? null,
      studioId: activeStudioId,
      locationId: locationFilter === "__unassigned" ? null : locationFilter,
      q: url.searchParams.get("q") ?? "",
      status: url.searchParams.get("status") ?? "",
    });
    if (!result.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    table = result.table;
  } else if (kind === "packages") {
    table = await buildPackageExportTable({
      studioIds: [activeStudioId],
      locationId: locationFilter === "__unassigned" ? null : locationFilter,
    });
  } else {
    table = await buildSaleExportTable({
      studioId: activeStudioId,
      dateFrom: url.searchParams.get("date_from"),
      dateTo: url.searchParams.get("date_to"),
      locationId: locationFilter === "__unassigned" ? null : locationFilter,
      unassigned: locationFilter === "__unassigned",
      employeeId: url.searchParams.get("employee_id")?.trim() || null,
      serviceId: url.searchParams.get("service_id")?.trim() || null,
      source: url.searchParams.get("source")?.trim() || null,
      salesChannel: url.searchParams.get("sales_channel")?.trim() || null,
      exportCap,
    });
  }

  if (!exportHeadersAreSafe(table.headers)) {
    console.error("[EXP-01] blocked sensitive export headers", { kind, headers: table.headers });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const capped = applyExportCap(table.rows, exportCap);
  const payload = await buildDeferredExportPayload({
    format,
    headers: table.headers,
    rows: capped.rows,
  });
  await writeStrongAudit({
    studioId: activeStudioId,
    actorType: "user",
    actorId: user.id,
    actorRole,
    action: "business_export",
    targetType: "business_export",
    targetId: activeStudioId,
    locationId: locationFilter === "__unassigned" ? null : locationFilter,
    afterState: {
      kind,
      format,
      capped: capped.wasCapped,
      date_from: url.searchParams.get("date_from"),
      date_to: url.searchParams.get("date_to"),
    },
  });

  const filename = `${kind}-export-${localISODate()}.${format}`;
  const responseBody = typeof payload.body === "string"
    ? payload.body
    : new Blob([new Uint8Array(Array.from(payload.body))]);
  return new NextResponse(responseBody, {
    headers: {
      "content-type": payload.contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      ...buildExportCapHeaders({
        wasCapped: capped.wasCapped,
        exportCap: capped.exportCap,
        rowCount: capped.rows.length,
      }),
    },
  });
}
