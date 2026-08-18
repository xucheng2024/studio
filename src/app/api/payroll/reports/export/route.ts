import { NextResponse } from "next/server";
import { localISODate } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { applyExportCap, buildExportCapHeaders, resolveExportCap, type ExportFormat } from "@/lib/export-cap";
import { isOwnerPayrollRole } from "@/lib/payroll-profiles";
import { buildPayrollReport, type PayrollReportKind } from "@/lib/payroll-reports";
import { buildDeferredExportPayload } from "@/lib/reports-deferred-export";
import { writeStrongAudit } from "@/lib/strong-audit";
import { createClient } from "@/lib/supabase/server";

const KINDS = new Set<PayrollReportKind>(["summary", "commission", "statutory"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioId = url.searchParams.get("studio_id");
  const kind = url.searchParams.get("kind") as PayrollReportKind | null;
  const periodStart = url.searchParams.get("period_start")?.trim() || null;
  const requestedFormat = (url.searchParams.get("format") ?? "").toLowerCase();
  const format: ExportFormat = requestedFormat === "tsv" || requestedFormat === "xlsx" || requestedFormat === "xml"
    ? requestedFormat
    : "csv";

  if (!studioId || !kind || !KINDS.has(kind)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ctx, studioIds } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId, locationId: null },
    ["owner"],
  );
  if (!studioIds.includes(studioId) || !isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { exportCap } = resolveExportCap(format);
  const report = await buildPayrollReport({ studioId, kind, periodStart });
  const capped = applyExportCap(report.rows, exportCap);
  const payload = await buildDeferredExportPayload({
    format,
    headers: report.headers,
    rows: capped.rows,
  });
  await writeStrongAudit({
    studioId,
    actorType: "user",
    actorId: user.id,
    actorRole: "owner",
    action: "payroll_report_exported",
    targetType: "payroll_report",
    targetId: studioId,
    afterState: { kind, period_start: periodStart, format },
  });

  const filename = `payroll-${kind}${periodStart ? `-${periodStart.slice(0, 7)}` : ""}-${localISODate()}.${format}`;
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
