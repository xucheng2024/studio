import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import {
  applyPkg02AdjustmentRequestAction,
  approvePkg02AdjustmentRequestAction,
  createPkg02AdjustmentRequestAction,
  rejectPkg02AdjustmentRequestAction,
  submitPkg02AdjustmentRequestAction,
} from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { PKG_APPROVAL_SELF_ACTION_BLOCKED_MESSAGE } from "@/lib/pkg-approval-messages";
import { hasStudioGlobalLocationAccess, hasStudioRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected" | "applied";
type SortKey = "created_desc" | "created_asc" | "updated_desc" | "updated_asc";
type QuickView = "all" | "my_pending" | "my_initiated";
type ApprovalLogRow = {
  id: string;
  request_id: string;
  action: string;
  approval_role: string;
  actor_id: string | null;
  actor_role: string | null;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

const STATUS_VALUES: ApprovalStatus[] = ["draft", "submitted", "approved", "rejected", "applied"];
const SORT_VALUES: SortKey[] = ["created_desc", "created_asc", "updated_desc", "updated_asc"];
const VIEW_VALUES: QuickView[] = ["all", "my_pending", "my_initiated"];
const PAGE_SIZE_VALUES = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_BACKLOG_HOURS = 24;

const SORT_META: Record<SortKey, { label: string; column: "created_at" | "updated_at"; ascending: boolean }> = {
  created_desc: { label: "Created (newest)", column: "created_at", ascending: false },
  created_asc: { label: "Created (oldest)", column: "created_at", ascending: true },
  updated_desc: { label: "Updated (newest)", column: "updated_at", ascending: false },
  updated_asc: { label: "Updated (oldest)", column: "updated_at", ascending: true },
};

function asNested<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asSingleValue(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function asPositiveInt(value: string | string[] | undefined, fallback: number): number {
  const parsed = Number.parseInt(asSingleValue(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function hoursDiffFromNow(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const diffMs = now.getTime() - dt.getTime();
  if (diffMs < 0) return 0;
  return diffMs / (1000 * 60 * 60);
}

function statusBadgeClass(status: ApprovalStatus) {
  switch (status) {
    case "draft":
      return ui.badgeNeutral;
    case "submitted":
      return ui.badgeAmber;
    case "approved":
      return ui.badge;
    case "rejected":
      return ui.badgeRed;
    case "applied":
      return ui.badge;
    default:
      return ui.badgeNeutral;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("en-SG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildParams(input: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value) params.set(key, value);
  }
  return params;
}

export default async function PackageApprovalsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const studioIdFromQuery = asSingleValue(sp.studio_id) || null;
  const locationIdFromQuery = asSingleValue(sp.location_id) || null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId: studioIdFromQuery,
      locationId: locationIdFromQuery,
    },
    ["owner", "manager", "frontdesk"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const canChecker = hasStudioRole(ctx, activeStudioId, ["owner", "manager"]);
  const canMaker = hasStudioRole(ctx, activeStudioId, ["owner", "manager", "frontdesk"]);

  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");

  const rawStatusFilter = asSingleValue(sp.status);
  const statusFilter = STATUS_VALUES.includes(rawStatusFilter as ApprovalStatus) ? (rawStatusFilter as ApprovalStatus) : "";
  const requestedClientPackageId = asSingleValue(sp.client_package_id).trim();
  const rawSortKey = asSingleValue(sp.sort);
  const sortKey = SORT_VALUES.includes(rawSortKey as SortKey) ? (rawSortKey as SortKey) : "created_desc";
  const sortMeta = SORT_META[sortKey];
  const rawView = asSingleValue(sp.view);
  const quickView = VIEW_VALUES.includes(rawView as QuickView) ? (rawView as QuickView) : "all";
  const keyword = asSingleValue(sp.q).trim();
  const backlogOnly = asSingleValue(sp.backlog_only) === "1";
  const backlogHours = Math.min(24 * 30, asPositiveInt(sp.backlog_hours, DEFAULT_BACKLOG_HOURS));
  const now = new Date();
  const pageSizeCandidate = asPositiveInt(sp.page_size, DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZE_VALUES.includes(pageSizeCandidate as (typeof PAGE_SIZE_VALUES)[number])
    ? pageSizeCandidate
    : DEFAULT_PAGE_SIZE;
  const page = asPositiveInt(sp.page, 1);

  const effectiveStatusFilter: ApprovalStatus | "" = backlogOnly
    ? "approved"
    : quickView === "my_pending"
      ? "submitted"
      : statusFilter;

  let requestQuery = admin
    .from("pkg02_adjustment_requests")
    .select(
      "id, studio_id, location_id, client_package_id, salon_customer_id, package_id, requested_delta_credits, requested_value_delta_amount, currency, reason, status, maker_user_id, maker_actor_role, checker_user_id, checker_actor_role, rejection_reason, submitted_at, approved_at, rejected_at, applied_at, applied_ledger_entry_id, version, created_at, updated_at, locations(name), packages(name), salon_customers(full_name, email)",
      { count: "exact" },
    )
    .eq("studio_id", activeStudioId)
    .order(sortMeta.column, { ascending: sortMeta.ascending })
    .order("created_at", { ascending: false });

  if (selectedLocationId) {
    requestQuery = requestQuery.eq("location_id", selectedLocationId);
  }

  if (effectiveStatusFilter) {
    requestQuery = requestQuery.eq("status", effectiveStatusFilter);
  }

  if (backlogOnly) {
    const cutoffIso = new Date(now.getTime() - backlogHours * 60 * 60 * 1000).toISOString();
    requestQuery = requestQuery.lte("approved_at", cutoffIso);
  }

  if (quickView === "my_pending") {
    requestQuery = requestQuery.neq("maker_user_id", user.id);
  } else if (quickView === "my_initiated") {
    requestQuery = requestQuery.eq("maker_user_id", user.id);
  }

  if (keyword) {
    const escaped = keyword.replaceAll("%", "\\%").replaceAll(",", " ");
    requestQuery = requestQuery.or(`reason.ilike.%${escaped}%,rejection_reason.ilike.%${escaped}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: requestRows, count } = await requestQuery.range(from, to);
  const approvalRows = requestRows ?? [];

  let approvedBacklogCount = 0;
  if (backlogOnly) {
    approvedBacklogCount = count ?? 0;
  } else {
    const cutoffIso = new Date(now.getTime() - backlogHours * 60 * 60 * 1000).toISOString();
    let backlogCountQuery = admin
      .from("pkg02_adjustment_requests")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", activeStudioId)
      .eq("status", "approved")
      .lte("approved_at", cutoffIso);
    if (selectedLocationId) {
      backlogCountQuery = backlogCountQuery.eq("location_id", selectedLocationId);
    }
    const { count: backlogCount } = await backlogCountQuery;
    approvedBacklogCount = backlogCount ?? 0;
  }

  const totalCount = count ?? 0;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1;
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;

  const requestIds = approvalRows.map((row) => row.id);
  const { data: approvalLogsRaw } = requestIds.length
    ? await admin
        .from("pkg02_approval_logs")
        .select("id, request_id, action, approval_role, actor_id, actor_role, from_status, to_status, note, created_at")
        .in("request_id", requestIds)
        .order("created_at", { ascending: true })
    : { data: [] as const };
  const approvalLogs = (approvalLogsRaw ?? []) as ApprovalLogRow[];

  const approvalLogsByRequestId = new Map<string, ApprovalLogRow[]>();
  for (const row of approvalLogs) {
    const bucket = approvalLogsByRequestId.get(row.request_id) ?? [];
    bucket.push(row);
    approvalLogsByRequestId.set(row.request_id, bucket);
  }

  const actorIds = [
    ...new Set(
      [
        ...approvalRows.flatMap((row) => [row.maker_user_id, row.checker_user_id]),
        ...approvalLogs.map((row) => row.actor_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: actorUsers } = actorIds.length
    ? await admin.from("users").select("id, email").in("id", actorIds)
    : { data: [] as const };
  const actorEmailById = new Map((actorUsers ?? []).map((row) => [row.id, row.email ?? "-"]));

  let packageOptionsQuery = admin
    .from("client_packages")
    .select("id, client_id, credits_left, package_name_snapshot, created_at, packages!inner(id, name, studio_id, location_id)")
    .in("packages.studio_id", [activeStudioId])
    .order("created_at", { ascending: false })
    .limit(120);

  if (selectedLocationId) {
    packageOptionsQuery = packageOptionsQuery.eq("packages.location_id", selectedLocationId);
  }

  const { data: packageOptionsRaw } = await packageOptionsQuery;
  let packageOptions = packageOptionsRaw ?? [];

  if (requestedClientPackageId && !packageOptions.some((row) => row.id === requestedClientPackageId)) {
    const { data: requestedPackageRows } = await admin
      .from("client_packages")
      .select("id, client_id, credits_left, package_name_snapshot, created_at, packages!inner(id, name, studio_id, location_id)")
      .eq("id", requestedClientPackageId)
      .in("packages.studio_id", [activeStudioId])
      .limit(1);

    if (requestedPackageRows?.[0]) {
      packageOptions = [requestedPackageRows[0], ...packageOptions];
    }
  }

  const prefilledClientPackageId = requestedClientPackageId && packageOptions.some((row) => row.id === requestedClientPackageId)
    ? requestedClientPackageId
    : "";
  const packageClientIds = [...new Set(packageOptions.map((row) => row.client_id).filter((id): id is string => Boolean(id)))];

  const [{ data: packageUsers }, { data: packageProfiles }] = await Promise.all([
    packageClientIds.length
      ? admin.from("users").select("id, email").in("id", packageClientIds)
      : Promise.resolve({ data: [] as const }),
    packageClientIds.length
      ? admin.from("user_profiles").select("id, full_name").in("id", packageClientIds)
      : Promise.resolve({ data: [] as const }),
  ]);

  const packageUserEmailById = new Map((packageUsers ?? []).map((row) => [row.id, row.email ?? "-"]));
  const packageUserNameById = new Map((packageProfiles ?? []).map((row) => [row.id, row.full_name ?? "-"]));

  const baseQueryParams = {
    studio_id: activeStudioId,
    location_id: selectedLocationId ?? undefined,
    q: keyword || undefined,
    status: statusFilter || undefined,
    sort: sortKey,
    view: quickView,
    page_size: String(pageSize),
    backlog_only: backlogOnly ? "1" : undefined,
    backlog_hours: String(backlogHours),
    client_package_id: prefilledClientPackageId || undefined,
  };

  const buildApprovalsHref = (overrides: Record<string, string | undefined>) => {
    const params = buildParams({ ...baseQueryParams, ...overrides });
    return `/dashboard/packages/approvals${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const quickAllHref = buildApprovalsHref({ view: "all", status: statusFilter || undefined, page: "1" });
  const quickMyPendingHref = buildApprovalsHref({ view: "my_pending", status: undefined, page: "1" });
  const quickMyInitiatedHref = buildApprovalsHref({ view: "my_initiated", page: "1" });
  const quickApprovedBacklogHref = buildApprovalsHref({ backlog_only: "1", status: undefined, page: "1" });
  const prevPageHref = buildApprovalsHref({ page: String(page - 1) });
  const nextPageHref = buildApprovalsHref({ page: String(page + 1) });

  const backParams = buildParams({
    studio_id: activeStudioId,
    location_id: selectedLocationId ?? undefined,
  });
  const backHref = `/dashboard/packages?${backParams.toString()}`;

  return (
    <div className="flex flex-col gap-8">
      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locationRows ?? []}
          selectedStudioId={activeStudioId}
          selectedLocationId={selectedLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />
      </div>

      <div>
        <h1 className={ui.h1}>Package approvals</h1>
        <p className={`mt-2 ${ui.lead}`}>Maker-Checker workflow for manual package credit adjustments.</p>
        <div className="mt-3">
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to packages
          </DashboardAppLink>
        </div>
      </div>

      {canMaker ? (
        <details className={`chevron ${ui.card}`} open>
          <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
            <span>+ New adjustment request</span>
            <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Draft starts at status = draft</span>
          </summary>
          <ServerActionToastForm action={createPkg02AdjustmentRequestAction} className="mt-4 grid gap-3 lg:grid-cols-2">
            <input type="hidden" name="studio_id" value={activeStudioId} />
            <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />

            <label className="flex flex-col gap-1.5 lg:col-span-2">
              <span className={ui.label}>Client package</span>
              <select name="client_package_id" required className={ui.select} defaultValue={prefilledClientPackageId}>
                <option value="" disabled>
                  Select a client package
                </option>
                {packageOptions.map((row) => {
                  const packageRow = asNested<{ id: string; name: string | null }>(
                    row.packages as { id: string; name: string | null } | { id: string; name: string | null }[] | null,
                  );
                  const clientLabel = packageUserNameById.get(row.client_id) ?? packageUserEmailById.get(row.client_id) ?? row.client_id;
                  return (
                    <option key={row.id} value={row.id}>
                      {packageRow?.name ?? row.package_name_snapshot ?? "Package"} · {clientLabel} · credits left {row.credits_left}
                    </option>
                  );
                })}
              </select>
              {prefilledClientPackageId ? <p className={`text-xs ${ui.muted}`}>Prefilled from package details link.</p> : null}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Delta credits</span>
              <input name="requested_delta_credits" type="number" required className={ui.input} placeholder="-2" />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Value delta (SGD)</span>
              <input name="requested_value_delta_amount" type="number" step="0.01" className={ui.input} placeholder="-20.00" />
            </label>

            <label className="flex flex-col gap-1.5 lg:col-span-2">
              <span className={ui.label}>Reason</span>
              <textarea name="reason" required className={ui.input} rows={3} placeholder="Describe why this manual adjustment is needed." />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Currency</span>
              <input name="currency" defaultValue="SGD" className={ui.input} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Salon customer (optional)</span>
              <input name="salon_customer_id" className={ui.input} placeholder="UUID (optional)" />
            </label>

            <SubmitButton className={`${ui.btnPrimary} w-full lg:col-span-2 lg:w-fit`} pendingText="Creating draft...">
              Create draft
            </SubmitButton>
          </ServerActionToastForm>
        </details>
      ) : (
        <div className={ui.card}>
          <p className={ui.muted}>You do not have maker permission to create adjustment requests.</p>
        </div>
      )}

      <div className={`${ui.card} flex flex-wrap gap-2`}>
        <DashboardAppLink href={quickAllHref} className={quickView === "all" ? ui.btnPrimarySm : ui.btnSecondarySm}>
          All requests
        </DashboardAppLink>
        <DashboardAppLink
          href={quickMyPendingHref}
          className={quickView === "my_pending" ? ui.btnPrimarySm : ui.btnSecondarySm}
        >
          My pending approvals
        </DashboardAppLink>
        <DashboardAppLink
          href={quickMyInitiatedHref}
          className={quickView === "my_initiated" ? ui.btnPrimarySm : ui.btnSecondarySm}
        >
          My initiated
        </DashboardAppLink>
        <DashboardAppLink href={quickApprovedBacklogHref} className={backlogOnly ? ui.btnPrimarySm : ui.btnSecondarySm}>
          Approved backlog
        </DashboardAppLink>
      </div>

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-6`}>
        <input type="hidden" name="studio_id" value={activeStudioId} />
        <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
        <input type="hidden" name="view" value={quickView} />
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Search</span>
          <input name="q" defaultValue={keyword} className={ui.input} placeholder="Reason / rejection reason" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Status</span>
          <select name="status" className={ui.select} defaultValue={statusFilter} disabled={quickView === "my_pending"}>
            <option value="">All</option>
            {STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Sort</span>
          <select name="sort" className={ui.select} defaultValue={sortKey}>
            {SORT_VALUES.map((key) => (
              <option key={key} value={key}>
                {SORT_META[key].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Page size</span>
          <select name="page_size" className={ui.select} defaultValue={String(pageSize)}>
            {PAGE_SIZE_VALUES.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Backlog hours</span>
          <input name="backlog_hours" type="number" min={1} max={720} defaultValue={String(backlogHours)} className={ui.input} />
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-700">
          <input name="backlog_only" type="checkbox" value="1" defaultChecked={backlogOnly} />
          <span className={`text-sm ${ui.muted}`}>Only approved overdue</span>
        </label>
        <div className="flex items-end sm:col-span-6">
          <SubmitButton className={`${ui.btnSecondary} w-full`} pendingText="Filtering...">
            Apply filters
          </SubmitButton>
        </div>
      </form>

      <div className={`${ui.card} flex flex-wrap items-center justify-between gap-2 text-sm`}>
        <p className={ui.muted}>
          Showing {(approvalRows.length === 0 ? 0 : from + 1).toLocaleString()}-{Math.min(from + approvalRows.length, totalCount).toLocaleString()} of{" "}
          {totalCount.toLocaleString()} requests · {sortMeta.label}
        </p>
        <div className="flex items-center gap-2">
          {hasPrevPage ? (
            <DashboardAppLink href={prevPageHref} className={ui.btnSecondarySm}>
              Prev
            </DashboardAppLink>
          ) : (
            <span className={`${ui.btnSecondarySm} pointer-events-none opacity-50`}>Prev</span>
          )}
          <span className={`text-xs ${ui.muted}`}>
            Page {page} / {totalPages}
          </span>
          {hasNextPage ? (
            <DashboardAppLink href={nextPageHref} className={ui.btnSecondarySm}>
              Next
            </DashboardAppLink>
          ) : (
            <span className={`${ui.btnSecondarySm} pointer-events-none opacity-50`}>Next</span>
          )}
        </div>
      </div>

      <div className={`${ui.card} flex flex-wrap items-center justify-between gap-2 text-sm`}>
        <div>
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Approved backlog monitor</p>
          <p className={ui.muted}>Approved for ≥ {backlogHours}h and not yet applied.</p>
        </div>
        <span
          className={
            approvedBacklogCount > 0
              ? "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300"
              : "inline-flex items-center rounded-full border border-teal-200/70 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900 dark:border-teal-800/60 dark:bg-teal-950/60 dark:text-teal-100"
          }
        >
          {approvedBacklogCount.toLocaleString()} overdue
        </span>
      </div>

      {approvalRows.length === 0 ? (
        <div className={ui.emptyState}>
          <p className={ui.muted}>No approval requests found for current filters.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {approvalRows.map((row) => {
            const packageRow = asNested<{ name: string | null }>(row.packages as { name: string | null } | { name: string | null }[] | null);
            const locationRow = asNested<{ name: string | null }>(row.locations as { name: string | null } | { name: string | null }[] | null);
            const customerRow = asNested<{ full_name: string | null; email: string | null }>(
              row.salon_customers as
                | { full_name: string | null; email: string | null }
                | { full_name: string | null; email: string | null }[]
                | null,
            );

            const status = row.status as ApprovalStatus;
            const isSelfRequest = row.maker_user_id === user.id;
            const showSubmit = status === "draft" && row.maker_user_id === user.id;
            const showCheckerDecision = status === "submitted" && canChecker;
            const showApply = status === "approved" && canChecker;
            const timelineRows = approvalLogsByRequestId.get(row.id) ?? [];
            const approvedAgeHours = status === "approved" ? hoursDiffFromNow(row.approved_at, now) : null;
            const isApprovedBacklog = status === "approved" && approvedAgeHours != null && approvedAgeHours >= backlogHours;
            const itemClass = isApprovedBacklog
              ? `${ui.card} space-y-4 border-amber-300 bg-amber-50/30 dark:border-amber-700/70 dark:bg-amber-950/20`
              : `${ui.card} space-y-4`;

            return (
              <li key={row.id} className={itemClass}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{packageRow?.name ?? "Package"}</p>
                    <p className={`text-xs ${ui.muted}`}>Request {row.id} · Client package {row.client_package_id}</p>
                    {isApprovedBacklog && approvedAgeHours != null ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Backlog alert: approved for {Math.floor(approvedAgeHours)}h (threshold {backlogHours}h)
                      </p>
                    ) : null}
                  </div>
                  <span className={statusBadgeClass(status)}>{status}</span>
                </div>

                <div className="grid gap-2 text-sm text-stone-700 dark:text-stone-300 sm:grid-cols-2 lg:grid-cols-3">
                  <p>Customer: {customerRow?.full_name ?? customerRow?.email ?? row.salon_customer_id}</p>
                  <p>Location: {locationRow?.name ?? "All"}</p>
                  <p>Delta credits: {row.requested_delta_credits}</p>
                  <p>
                    Value delta: {row.requested_value_delta_amount ?? "-"} {row.currency}
                  </p>
                  <p>Maker: {actorEmailById.get(row.maker_user_id) ?? row.maker_user_id}</p>
                  <p>Checker: {row.checker_user_id ? (actorEmailById.get(row.checker_user_id) ?? row.checker_user_id) : "-"}</p>
                  <p>Version: {row.version}</p>
                  <p>Created: {formatDateTime(row.created_at)}</p>
                  <p>Updated: {formatDateTime(row.updated_at)}</p>
                </div>

                {row.reason ? <p className={`text-sm ${ui.muted}`}>Reason: {row.reason}</p> : null}
                {row.rejection_reason ? <p className="text-sm text-red-600 dark:text-red-400">Rejection reason: {row.rejection_reason}</p> : null}
                {row.applied_ledger_entry_id ? <p className={`text-xs ${ui.muted}`}>Ledger entry: {row.applied_ledger_entry_id}</p> : null}

                {timelineRows.length ? (
                  <details>
                    <summary className={`cursor-pointer text-xs ${ui.muted}`}>Approval timeline ({timelineRows.length})</summary>
                    <ul className="mt-2 space-y-2">
                      {timelineRows.map((timelineRow) => {
                        const actor = timelineRow.actor_id ? (actorEmailById.get(timelineRow.actor_id) ?? timelineRow.actor_id) : "system";
                        return (
                          <li key={timelineRow.id} className="rounded-lg border border-stone-200/80 p-2 text-xs dark:border-stone-700/80">
                            <p className="font-medium text-stone-800 dark:text-stone-100">
                              {timelineRow.action} · {timelineRow.from_status ?? "-"} → {timelineRow.to_status}
                            </p>
                            <p className={ui.muted}>
                              {formatDateTime(timelineRow.created_at)} · {timelineRow.approval_role} · {actor}
                            </p>
                            {timelineRow.note ? <p className={`mt-1 ${ui.muted}`}>Note: {timelineRow.note}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}

                <div className="grid gap-2 lg:grid-cols-2">
                  {showSubmit ? (
                    <ServerActionToastForm action={submitPkg02AdjustmentRequestAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="studio_id" value={activeStudioId} />
                      <input type="hidden" name="request_id" value={row.id} />
                      <input type="hidden" name="expected_version" value={String(row.version)} />
                      <input type="hidden" name="note" value="submitted from dashboard approvals" />
                      <SubmitButton className={ui.btnPrimarySm} pendingText="Submitting...">
                        Submit
                      </SubmitButton>
                    </ServerActionToastForm>
                  ) : null}

                  {showCheckerDecision ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <ServerActionToastForm action={approvePkg02AdjustmentRequestAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="studio_id" value={activeStudioId} />
                        <input type="hidden" name="request_id" value={row.id} />
                        <input type="hidden" name="expected_version" value={String(row.version)} />
                        <input type="hidden" name="note" value="approved from dashboard approvals" />
                        <SubmitButton className={ui.btnPrimarySm} pendingText="Approving..." disabled={isSelfRequest}>
                          Approve
                        </SubmitButton>
                      </ServerActionToastForm>

                      <ServerActionToastForm action={rejectPkg02AdjustmentRequestAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="studio_id" value={activeStudioId} />
                        <input type="hidden" name="request_id" value={row.id} />
                        <input type="hidden" name="expected_version" value={String(row.version)} />
                        <input type="hidden" name="note" value="rejected from dashboard approvals" />
                        <input name="rejection_reason" className={ui.input} placeholder="Rejection reason" required />
                        <SubmitButton className={ui.btnDangerSm} pendingText="Rejecting..." disabled={isSelfRequest}>
                          Reject
                        </SubmitButton>
                      </ServerActionToastForm>
                    </div>
                  ) : null}

                  {showApply ? (
                    <ServerActionToastForm action={applyPkg02AdjustmentRequestAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="studio_id" value={activeStudioId} />
                      <input type="hidden" name="request_id" value={row.id} />
                      <input type="hidden" name="expected_version" value={String(row.version)} />
                      <input type="hidden" name="idempotency_key" value={`pkg02-apply:${row.id}:${row.version}:${crypto.randomUUID()}`} />
                      <input type="hidden" name="correlation_id" value={`pkg02-dashboard-apply:${row.id}:${row.version}`} />
                      <input name="note" className={ui.input} placeholder="Apply note (optional)" />
                      <SubmitButton className={ui.btnPrimarySm} pendingText="Applying..." disabled={isSelfRequest}>
                        Apply to ledger
                      </SubmitButton>
                    </ServerActionToastForm>
                  ) : null}
                </div>

                {(showCheckerDecision || showApply) && isSelfRequest ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">{PKG_APPROVAL_SELF_ACTION_BLOCKED_MESSAGE}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
