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
import { hasStudioGlobalLocationAccess, hasStudioRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    status?: string;
    q?: string;
  }>;
};

type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected" | "applied";

const STATUS_VALUES: ApprovalStatus[] = ["draft", "submitted", "approved", "rejected", "applied"];

function asNested<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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

export default async function PackageApprovalsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId: sp.studio_id ?? null,
      locationId: sp.location_id ?? null,
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

  const statusFilter = STATUS_VALUES.includes((sp.status ?? "") as ApprovalStatus)
    ? (sp.status as ApprovalStatus)
    : "";
  const keyword = (sp.q ?? "").trim().toLowerCase();

  let requestQuery = admin
    .from("pkg02_adjustment_requests")
    .select(
      "id, studio_id, location_id, client_package_id, salon_customer_id, package_id, requested_delta_credits, requested_value_delta_amount, currency, reason, status, maker_user_id, maker_actor_role, checker_user_id, checker_actor_role, rejection_reason, submitted_at, approved_at, rejected_at, applied_at, applied_ledger_entry_id, version, created_at, locations(name), packages(name), salon_customers(full_name, email)",
    )
    .eq("studio_id", activeStudioId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (selectedLocationId) {
    requestQuery = requestQuery.eq("location_id", selectedLocationId);
  }
  if (statusFilter) {
    requestQuery = requestQuery.eq("status", statusFilter);
  }

  const { data: requestRows } = await requestQuery;

  const approvalRows = (requestRows ?? []).filter((row) => {
    if (!keyword) return true;
    const packageRow = asNested<{ name: string | null }>(row.packages as { name: string | null } | { name: string | null }[] | null);
    const customerRow = asNested<{ full_name: string | null; email: string | null }>(
      row.salon_customers as
        | { full_name: string | null; email: string | null }
        | { full_name: string | null; email: string | null }[]
        | null,
    );
    const haystack = [
      row.id,
      row.client_package_id,
      row.reason,
      row.rejection_reason,
      packageRow?.name,
      customerRow?.full_name,
      customerRow?.email,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });

  const actorIds = [
    ...new Set(
      approvalRows
        .flatMap((row) => [row.maker_user_id, row.checker_user_id])
        .filter((id): id is string => Boolean(id)),
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
  const packageOptions = packageOptionsRaw ?? [];
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

  const backParams = new URLSearchParams();
  backParams.set("studio_id", activeStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
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
        <p className={`mt-2 ${ui.lead}`}>
          Maker-Checker workflow for manual package credit adjustments.
        </p>
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
              <select name="client_package_id" required className={ui.select} defaultValue="">
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

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-4`}>
        <input type="hidden" name="studio_id" value={activeStudioId} />
        <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Search</span>
          <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="Request ID / package / customer / reason" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Status</span>
          <select name="status" className={ui.select} defaultValue={statusFilter}>
            <option value="">All</option>
            {STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <SubmitButton className={`${ui.btnSecondary} w-full`} pendingText="Filtering...">
            Apply filters
          </SubmitButton>
        </div>
      </form>

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

            return (
              <li key={row.id} className={`${ui.card} space-y-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{packageRow?.name ?? "Package"}</p>
                    <p className={`text-xs ${ui.muted}`}>
                      Request {row.id} · Client package {row.client_package_id}
                    </p>
                  </div>
                  <span className={statusBadgeClass(status)}>{status}</span>
                </div>

                <div className="grid gap-2 text-sm text-stone-700 dark:text-stone-300 sm:grid-cols-2 lg:grid-cols-3">
                  <p>Customer: {customerRow?.full_name ?? customerRow?.email ?? row.salon_customer_id}</p>
                  <p>Location: {locationRow?.name ?? "All"}</p>
                  <p>Delta credits: {row.requested_delta_credits}</p>
                  <p>Value delta: {row.requested_value_delta_amount ?? "-"} {row.currency}</p>
                  <p>Maker: {actorEmailById.get(row.maker_user_id) ?? row.maker_user_id}</p>
                  <p>Checker: {row.checker_user_id ? (actorEmailById.get(row.checker_user_id) ?? row.checker_user_id) : "-"}</p>
                  <p>Version: {row.version}</p>
                  <p>Created: {formatDateTime(row.created_at)}</p>
                  <p>Updated: {formatDateTime(row.updated_at)}</p>
                </div>

                {row.reason ? <p className={`text-sm ${ui.muted}`}>Reason: {row.reason}</p> : null}
                {row.rejection_reason ? <p className="text-sm text-red-600 dark:text-red-400">Rejection reason: {row.rejection_reason}</p> : null}
                {row.applied_ledger_entry_id ? (
                  <p className={`text-xs ${ui.muted}`}>Ledger entry: {row.applied_ledger_entry_id}</p>
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
                      <input
                        type="hidden"
                        name="idempotency_key"
                        value={`pkg02-apply:${row.id}:${row.version}:${crypto.randomUUID()}`}
                      />
                      <input
                        type="hidden"
                        name="correlation_id"
                        value={`pkg02-dashboard-apply:${row.id}:${row.version}`}
                      />
                      <input name="note" className={ui.input} placeholder="Apply note (optional)" />
                      <SubmitButton className={ui.btnPrimarySm} pendingText="Applying..." disabled={isSelfRequest}>
                        Apply to ledger
                      </SubmitButton>
                    </ServerActionToastForm>
                  ) : null}
                </div>

                {(showCheckerDecision || showApply) && isSelfRequest ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Self-approval/apply is blocked for maker.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

