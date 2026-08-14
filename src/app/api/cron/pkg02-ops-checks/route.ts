import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AdjustmentRequestRow = {
  id: string;
  studio_id: string;
  status: string;
  maker_user_id: string;
  checker_user_id: string | null;
  applied_ledger_entry_id: string | null;
  client_package_id: string;
  requested_delta_credits: number;
  requested_value_delta_amount: number | null;
  currency: string;
  updated_at: string;
  approved_at: string | null;
};

type LedgerRow = {
  id: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  client_package_id: string;
  delta_credits: number;
  value_delta_amount: number | null;
  currency: string;
};

type CheckSummary = {
  check_name: string;
  expected: string;
  actual: number;
  result: "pass" | "fail";
};

function getCheckActual(checks: CheckSummary[], name: string) {
  return checks.find((row) => row.check_name === name)?.actual ?? 0;
}

function toNumeric(value: number | string | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRunDetailUrl(params: {
  runId: string | null;
  studioId: string | null;
  locationId: string | null;
}) {
  if (!params.runId) return null;

  const query = new URLSearchParams();
  if (params.studioId) query.set("studio_id", params.studioId);
  if (params.locationId) query.set("location_id", params.locationId);

  const path = `/dashboard/operations/pkg02-checks/${params.runId}${query.toString() ? `?${query.toString()}` : ""}`;
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  return appBaseUrl ? `${appBaseUrl}${path}` : path;
}

function inChunks<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchAllAdjustmentRequests(
  admin: ReturnType<typeof createAdminClient>,
  studioId: string | null,
  locationId: string | null,
) {
  const pageSize = 1000;
  let from = 0;
  const rows: AdjustmentRequestRow[] = [];

  while (true) {
    let query = admin
      .from("pkg02_adjustment_requests")
      .select(
        "id, studio_id, status, maker_user_id, checker_user_id, applied_ledger_entry_id, client_package_id, requested_delta_credits, requested_value_delta_amount, currency, updated_at, approved_at",
      )
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (studioId) query = query.eq("studio_id", studioId);
    if (locationId) query = query.eq("location_id", locationId);

    const { data, error } = await query;
    if (error) throw error;

    const batch = (data ?? []) as AdjustmentRequestRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchLedgerByIds(admin: ReturnType<typeof createAdminClient>, ids: string[]) {
  const rows: LedgerRow[] = [];
  const chunks = inChunks(ids, 500);
  for (const chunk of chunks) {
    const { data, error } = await admin
      .from("client_package_ledger_entries")
      .select("id, event_type, source_type, source_id, client_package_id, delta_credits, value_delta_amount, currency")
      .in("id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as LedgerRow[]));
  }
  return rows;
}

function buildSlackText(params: {
  studioId: string | null;
  checks: CheckSummary[];
  selfApprovalSamples: AdjustmentRequestRow[];
  approvedBacklogSamples: AdjustmentRequestRow[];
  missingLedgerSamples: AdjustmentRequestRow[];
  reconcileDiffSamples: AdjustmentRequestRow[];
}) {
  const scopeLabel = params.studioId ? `studio ${params.studioId}` : "all studios";
  const lines = [
    `⚠️ PKG-02 ops checks detected anomalies (${scopeLabel})`,
    ...params.checks.map((row) => `• ${row.check_name}: ${row.actual} (${row.result})`),
    `• self_approval samples: ${params.selfApprovalSamples.length}`,
    `• approved_backlog samples: ${params.approvedBacklogSamples.length}`,
    `• missing_ledger samples: ${params.missingLedgerSamples.length}`,
    `• reconcile_diff samples: ${params.reconcileDiffSamples.length}`,
  ];
  return lines.join("\n");
}

async function sendSlackAlert(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`slack_webhook_failed:${response.status}:${body.slice(0, 200)}`);
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const studioId = (url.searchParams.get("studio_id") ?? process.env.PKG02_OPS_STUDIO_ID ?? "").trim() || null;
  const locationId = (url.searchParams.get("location_id") ?? process.env.PKG02_OPS_LOCATION_ID ?? "").trim() || null;
  const dryRun = (url.searchParams.get("dry_run") ?? "").toLowerCase() === "1";
  const backlogThresholdRaw = Number(
    url.searchParams.get("backlog_threshold") ?? process.env.PKG02_APPROVED_BACKLOG_ALERT_THRESHOLD ?? "20",
  );
  const approvedBacklogAlertThreshold = Number.isFinite(backlogThresholdRaw)
    ? Math.max(0, Math.trunc(backlogThresholdRaw))
    : 20;

  const admin = createAdminClient();
  const requests = await fetchAllAdjustmentRequests(admin, studioId, locationId);

  const selfApprovalRows = requests
    .filter((row) => Boolean(row.checker_user_id) && row.checker_user_id === row.maker_user_id)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

  const approvedBacklogRows = requests
    .filter((row) => row.status === "approved")
    .sort((left, right) => (left.approved_at ?? "").localeCompare(right.approved_at ?? ""));

  const appliedRows = requests.filter((row) => row.status === "applied");
  const ledgerIds = [...new Set(appliedRows.map((row) => row.applied_ledger_entry_id).filter((id): id is string => Boolean(id)))];
  const ledgers = await fetchLedgerByIds(admin, ledgerIds);
  const ledgerById = new Map(ledgers.map((row) => [row.id, row]));

  const missingLedgerRows = appliedRows.filter((row) => {
    if (!row.applied_ledger_entry_id) return true;
    const ledger = ledgerById.get(row.applied_ledger_entry_id);
    if (!ledger) return true;
    return ledger.event_type !== "manual_adjustment" || ledger.source_type !== "pkg02_adjustment_request" || ledger.source_id !== row.id;
  });

  const reconcileDiffRows = appliedRows.filter((row) => {
    if (!row.applied_ledger_entry_id) return true;
    const ledger = ledgerById.get(row.applied_ledger_entry_id);
    if (!ledger) return true;

    return (
      ledger.event_type !== "manual_adjustment" ||
      ledger.source_type !== "pkg02_adjustment_request" ||
      ledger.source_id !== row.id ||
      ledger.client_package_id !== row.client_package_id ||
      ledger.delta_credits !== row.requested_delta_credits ||
      toNumeric(ledger.value_delta_amount) !== toNumeric(row.requested_value_delta_amount) ||
      ledger.currency !== row.currency
    );
  });

  const checks: CheckSummary[] = [
    {
      check_name: "self_approval_or_apply",
      expected: "0",
      actual: selfApprovalRows.length,
      result: selfApprovalRows.length === 0 ? "pass" : "fail",
    },
    {
      check_name: "approved_not_applied_backlog",
      expected: `<= ${approvedBacklogAlertThreshold}`,
      actual: approvedBacklogRows.length,
      result: approvedBacklogRows.length <= approvedBacklogAlertThreshold ? "pass" : "fail",
    },
    {
      check_name: "applied_missing_manual_adjustment_ledger",
      expected: "0",
      actual: missingLedgerRows.length,
      result: missingLedgerRows.length === 0 ? "pass" : "fail",
    },
    {
      check_name: "manual_adjustment_reconcile_diff",
      expected: "0",
      actual: reconcileDiffRows.length,
      result: reconcileDiffRows.length === 0 ? "pass" : "fail",
    },
  ];

  const hasAnomaly = checks.some((row) => row.result === "fail");
  const webhookUrl = process.env.OPS_ALERT_SLACK_WEBHOOK_URL?.trim() || "";

  const selfApprovalSamples = selfApprovalRows.slice(0, 5);
  const approvedBacklogSamples = approvedBacklogRows.slice(0, 5);
  const missingLedgerSamples = missingLedgerRows.slice(0, 5);
  const reconcileDiffSamples = reconcileDiffRows.slice(0, 5);

  let notifyStatus: "sent" | "skipped" | "failed" = "skipped";
  let notifyReason: string | null = null;

  if (!dryRun && hasAnomaly) {
    if (!webhookUrl) {
      notifyStatus = "failed";
      notifyReason = "missing OPS_ALERT_SLACK_WEBHOOK_URL";
    } else {
      try {
        const text = buildSlackText({
          studioId,
          checks,
          selfApprovalSamples,
          approvedBacklogSamples,
          missingLedgerSamples,
          reconcileDiffSamples,
        });
        await sendSlackAlert(webhookUrl, text);
        notifyStatus = "sent";
      } catch (error) {
        notifyStatus = "failed";
        notifyReason = error instanceof Error ? error.message : "unknown_notification_error";
      }
    }
  }

  const checksPayload = checks.map((row) => ({
    check_name: row.check_name,
    expected: row.expected,
    actual: row.actual,
    result: row.result,
  }));

  const samplesPayload = {
    self_approval_or_apply: selfApprovalSamples,
    approved_not_applied_backlog: approvedBacklogSamples,
    applied_missing_manual_adjustment_ledger: missingLedgerSamples,
    manual_adjustment_reconcile_diff: reconcileDiffSamples,
  };

  let runId: string | null = null;
  let persistStatus: "written" | "failed" = "written";
  let persistReason: string | null = null;

  try {
    const { data: inserted, error: persistError } = await admin
      .from("pkg02_ops_check_runs")
      .insert({
        studio_id: studioId,
        location_id: locationId,
        backlog_threshold_hours: approvedBacklogAlertThreshold,
        self_approval_or_apply_count: getCheckActual(checks, "self_approval_or_apply"),
        approved_not_applied_backlog_count: getCheckActual(checks, "approved_not_applied_backlog"),
        applied_missing_manual_adjustment_ledger_count: getCheckActual(checks, "applied_missing_manual_adjustment_ledger"),
        manual_adjustment_reconcile_diff_count: getCheckActual(checks, "manual_adjustment_reconcile_diff"),
        total_requests_scanned: requests.length,
        has_anomaly: hasAnomaly,
        notify_status: notifyStatus,
        notify_reason: notifyReason,
        checks: checksPayload,
        samples: samplesPayload,
      })
      .select("id")
      .single();

    if (persistError) {
      persistStatus = "failed";
      persistReason = persistError.message;
    } else {
      runId = inserted?.id ?? null;
    }
  } catch (error) {
    persistStatus = "failed";
    persistReason = error instanceof Error ? error.message : "unknown_persist_error";
  }

  const runDetailUrl = buildRunDetailUrl({
    runId,
    studioId,
    locationId,
  });

  return NextResponse.json({
    ok: true,
    studio_id: studioId,
    location_id: locationId,
    checked_at: new Date().toISOString(),
    approved_backlog_alert_threshold: approvedBacklogAlertThreshold,
    checks,
    total_requests_scanned: requests.length,
    run_log: {
      run_id: runId,
      run_detail_url: runDetailUrl,
      status: persistStatus,
      reason: persistReason,
    },
    notify: {
      status: notifyStatus,
      reason: notifyReason,
      dry_run: dryRun,
      has_anomaly: hasAnomaly,
    },
    samples: samplesPayload,
  });
}
