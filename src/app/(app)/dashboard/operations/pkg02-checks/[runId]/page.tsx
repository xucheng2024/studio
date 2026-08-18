import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

type Pkg02OpsCheckName =
  | "self_approval_or_apply"
  | "approved_not_applied_backlog"
  | "applied_missing_manual_adjustment_ledger"
  | "manual_adjustment_reconcile_diff";

type Pkg02OpsCheckSummary = {
  check_name: Pkg02OpsCheckName;
  expected: string;
  actual: number;
  result: "pass" | "fail";
};

type Pkg02OpsSampleRow = {
  id: string;
  status: string;
  maker_user_id: string;
  checker_user_id: string | null;
  client_package_id: string;
  applied_ledger_entry_id: string | null;
  requested_delta_credits: number;
  requested_value_delta_amount: number | null;
  currency: string;
  approved_at: string | null;
  updated_at: string;
};

type Pkg02OpsCheckRunDetailRow = {
  id: string;
  studio_id: string | null;
  location_id: string | null;
  checked_at: string;
  backlog_threshold_hours: number;
  total_requests_scanned: number;
  has_anomaly: boolean;
  self_approval_or_apply_count: number;
  approved_not_applied_backlog_count: number;
  applied_missing_manual_adjustment_ledger_count: number;
  manual_adjustment_reconcile_diff_count: number;
  notify_status: "sent" | "skipped" | "failed";
  notify_reason: string | null;
  checks: unknown;
  samples: unknown;
};

const CHECK_CONFIG: {
  key: Pkg02OpsCheckName;
  label: string;
  description: string;
}[] = [
  {
    key: "self_approval_or_apply",
    label: "Same-person action",
    description: "The person who requested a credit change cannot approve or apply it.",
  },
  {
    key: "approved_not_applied_backlog",
    label: "Waiting to apply",
    description: "Approved credit changes that have not been applied yet.",
  },
  {
    key: "applied_missing_manual_adjustment_ledger",
    label: "Missing credit record",
    description: "A credit change was marked applied but the customer balance was not updated.",
  },
  {
    key: "manual_adjustment_reconcile_diff",
    label: "Credit mismatch",
    description: "The applied credits do not match what was approved."
  },
];

function toStringSafe(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumberSafe(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toCheckList(value: unknown): Pkg02OpsCheckSummary[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const checkName = toStringSafe(record.check_name) as Pkg02OpsCheckName;
      if (!CHECK_CONFIG.some((item) => item.key === checkName)) return null;
      const resultRaw = toStringSafe(record.result);
      const result = resultRaw === "pass" ? "pass" : "fail";
      return {
        check_name: checkName,
        expected: toStringSafe(record.expected) || "-",
        actual: toNumberSafe(record.actual),
        result,
      } as Pkg02OpsCheckSummary;
    })
    .filter((row): row is Pkg02OpsCheckSummary => Boolean(row));
}

function toSamplesMap(value: unknown): Record<Pkg02OpsCheckName, Pkg02OpsSampleRow[]> {
  const base: Record<Pkg02OpsCheckName, Pkg02OpsSampleRow[]> = {
    self_approval_or_apply: [],
    approved_not_applied_backlog: [],
    applied_missing_manual_adjustment_ledger: [],
    manual_adjustment_reconcile_diff: [],
  };

  if (!value || typeof value !== "object") return base;
  const payload = value as Record<string, unknown>;

  for (const check of CHECK_CONFIG) {
    const rows = payload[check.key];
    if (!Array.isArray(rows)) continue;

    base[check.key] = rows
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const id = toStringSafe(record.id);
        if (!id) return null;

        return {
          id,
          status: toStringSafe(record.status) || "-",
          maker_user_id: toStringSafe(record.maker_user_id) || "-",
          checker_user_id: toStringSafe(record.checker_user_id) || null,
          client_package_id: toStringSafe(record.client_package_id) || "-",
          applied_ledger_entry_id: toStringSafe(record.applied_ledger_entry_id) || null,
          requested_delta_credits: toNumberSafe(record.requested_delta_credits),
          requested_value_delta_amount:
            record.requested_value_delta_amount == null ? null : toNumberSafe(record.requested_value_delta_amount),
          currency: toStringSafe(record.currency) || "-",
          approved_at: toStringSafe(record.approved_at) || null,
          updated_at: toStringSafe(record.updated_at) || "",
        } as Pkg02OpsSampleRow;
      })
      .filter((row): row is Pkg02OpsSampleRow => Boolean(row));
  }

  return base;
}

function checkCountFromRun(run: Pkg02OpsCheckRunDetailRow, checkName: Pkg02OpsCheckName) {
  if (checkName === "self_approval_or_apply") return run.self_approval_or_apply_count;
  if (checkName === "approved_not_applied_backlog") return run.approved_not_applied_backlog_count;
  if (checkName === "applied_missing_manual_adjustment_ledger") return run.applied_missing_manual_adjustment_ledger_count;
  return run.manual_adjustment_reconcile_diff_count;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "-";
  return date.toLocaleString("en-SG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildQuery(studioId: string, locationId: string | null) {
  const query = new URLSearchParams();
  query.set("studio_id", studioId);
  if (locationId) query.set("location_id", locationId);
  return query.toString();
}

function buildApprovalsRequestHref(params: {
  studioId: string;
  fallbackLocationId: string | null;
  runLocationId: string | null;
  requestId: string;
}) {
  const query = new URLSearchParams();
  query.set("studio_id", params.studioId);
  const scopedLocationId = params.runLocationId ?? params.fallbackLocationId;
  if (scopedLocationId) query.set("location_id", scopedLocationId);
  query.set("request_id", params.requestId);
  query.set("page", "1");
  return `/dashboard/packages/approvals?${query.toString()}`;
}

export default async function Pkg02OpsCheckRunDetailPage({ params, searchParams }: Props) {
  const { runId } = await params;
  const sp = await searchParams;
  const requestedStudioId = sp.studio_id?.trim() ?? "";
  const requestedLocationId = sp.location_id?.trim() || null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: requestedStudioId || null,
    locationId: requestedLocationId,
  }, ["owner", "manager", "frontdesk"]);

  if (!requestedStudioId || !selectedStudioId || !studioIds.includes(selectedStudioId)) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href="/dashboard/operations" className={ui.btnSecondarySm}>
          Back to bookings
        </DashboardAppLink>
        <p className={ui.muted}>Open this page from the package adjustment checks on Bookings.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: runData } = await admin
    .from("pkg02_ops_check_runs")
    .select(
      "id, studio_id, location_id, checked_at, backlog_threshold_hours, total_requests_scanned, has_anomaly, self_approval_or_apply_count, approved_not_applied_backlog_count, applied_missing_manual_adjustment_ledger_count, manual_adjustment_reconcile_diff_count, notify_status, notify_reason, checks, samples",
    )
    .eq("id", runId)
    .eq("studio_id", selectedStudioId)
    .maybeSingle();

  const run = (runData ?? null) as Pkg02OpsCheckRunDetailRow | null;
  const backQuery = buildQuery(selectedStudioId, requestedLocationId);
  const approvalsBacklogQuery = new URLSearchParams(backQuery);
  approvalsBacklogQuery.set("backlog_only", "1");

  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/operations?${backQuery}`} className={ui.btnSecondarySm}>
            Back to bookings
          </DashboardAppLink>
        </div>
        <p className={ui.muted}>This check was not found for the current studio.</p>
      </div>
    );
  }

  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, selectedStudioId);
  if (!canViewAllLocations && run.location_id && !accessibleLocationIds.includes(run.location_id)) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={`/dashboard/operations?${backQuery}`} className={ui.btnSecondarySm}>
            Back to bookings
          </DashboardAppLink>
          <p className={ui.error}>You do not have access to this location.</p>
      </div>
    );
  }

  const checks = toCheckList(run.checks);
  const checkByName = new Map(checks.map((item) => [item.check_name, item]));
  const samples = toSamplesMap(run.samples);
  const runLocationLabel = run.location_id ?? "All locations";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/operations?${backQuery}`} className={ui.btnSecondarySm}>
            Back to bookings
          </DashboardAppLink>
          <DashboardAppLink href={`/dashboard/packages/approvals?${approvalsBacklogQuery.toString()}`} className={ui.btnSecondarySm}>
            Open waiting adjustments
          </DashboardAppLink>
        </div>
        <span className={run.has_anomaly ? ui.badgeAmber : ui.badge}>
          {run.has_anomaly ? "Needs review" : "All clear"}
        </span>
      </div>

      <section className={ui.card}>
        <h1 className={ui.h1}>Package adjustment check</h1>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className={`text-xs ${ui.muted}`}>Check ID</dt>
            <dd className="break-all font-mono text-xs text-stone-900 dark:text-stone-100">{run.id}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Checked at</dt>
            <dd>{formatDateTime(run.checked_at)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Location scope</dt>
            <dd className="break-all">{runLocationLabel}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Requests scanned</dt>
            <dd>{run.total_requests_scanned}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Backlog alert threshold</dt>
            <dd>{run.backlog_threshold_hours}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Alert status</dt>
            <dd>{run.notify_status}</dd>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <dt className={`text-xs ${ui.muted}`}>Alert reason</dt>
            <dd className="break-all">{run.notify_reason ?? "-"}</dd>
          </div>
        </dl>
      </section>

      {CHECK_CONFIG.map((item) => {
        const summary = checkByName.get(item.key);
        const actual = summary?.actual ?? checkCountFromRun(run, item.key);
        const result = summary?.result
          ?? (item.key === "approved_not_applied_backlog"
            ? (actual <= run.backlog_threshold_hours ? "pass" : "fail")
            : (actual === 0 ? "pass" : "fail"));
        const expected = summary?.expected ?? "-";
        const sampleRows = samples[item.key];

        return (
          <section key={item.key} className={ui.card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className={ui.h2}>{item.label}</h2>
                <p className={ui.muted}>{item.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={result === "fail" ? ui.badgeAmber : ui.badge}>
                  {result === "fail" ? "Fail" : "Pass"}
                </span>
                <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  Actual {actual}
                </span>
              </div>
            </div>

            <p className={`mt-2 text-xs ${ui.muted}`}>Expected: {expected}</p>

            {sampleRows.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                      <th className="py-2 pr-4 font-medium">Request ID</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Requested / approved by</th>
                      <th className="py-2 pr-4 font-medium">Package / credit record</th>
                      <th className="py-2 pr-4 font-medium">Credit change</th>
                      <th className="py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.map((sample) => (
                      <tr key={`${item.key}:${sample.id}`} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                        <td className="py-2.5 pr-4 align-top font-mono text-xs text-stone-700 dark:text-stone-300">
                          <DashboardAppLink
                            href={buildApprovalsRequestHref({
                              studioId: selectedStudioId,
                              fallbackLocationId: requestedLocationId,
                              runLocationId: run.location_id,
                              requestId: sample.id,
                            })}
                            className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                          >
                            {sample.id}
                          </DashboardAppLink>
                        </td>
                        <td className="py-2.5 pr-4 align-top text-stone-700 dark:text-stone-300">{sample.status}</td>
                        <td className="py-2.5 pr-4 align-top text-xs text-stone-700 dark:text-stone-300">
                          <p className="break-all">Requested by: {sample.maker_user_id}</p>
                          <p className="break-all">Approved by: {sample.checker_user_id ?? "-"}</p>
                        </td>
                        <td className="py-2.5 pr-4 align-top text-xs text-stone-700 dark:text-stone-300">
                          <p className="break-all">Package: {sample.client_package_id}</p>
                          <p className="break-all">Credit record: {sample.applied_ledger_entry_id ?? "-"}</p>
                        </td>
                        <td className="py-2.5 pr-4 align-top text-xs text-stone-700 dark:text-stone-300">
                          <p>Credits: {sample.requested_delta_credits}</p>
                          <p>
                            Amount: {sample.currency} {sample.requested_value_delta_amount == null ? "-" : sample.requested_value_delta_amount}
                          </p>
                        </td>
                        <td className="py-2.5 align-top text-xs text-stone-700 dark:text-stone-300">
                          <p>{formatDateTime(sample.updated_at)}</p>
                          <p className={ui.muted}>approved: {formatDateTime(sample.approved_at)}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={`mt-3 text-sm ${ui.muted}`}>No sample rows captured for this check in this run.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
