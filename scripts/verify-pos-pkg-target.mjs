/**
 * Read-only POS/Package target-environment preflight.
 *
 * Reports aggregate counts and invariant failures only. It never prints
 * customer data, payment details, secrets, or business record identifiers.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const studioId = process.env.POS_PKG_TARGET_STUDIO_ID?.trim() || null;

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function describeError(error) {
  return [error.message, error.code, error.details, error.hint].filter(Boolean).join(" | ") || "unknown Supabase error";
}

function scope(query) {
  return studioId ? query.eq("studio_id", studioId) : query;
}

async function countRows(table, configure = (query) => query) {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  query = scope(query);
  query = configure(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${describeError(error)}`);
  return count ?? 0;
}

async function main() {
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    posSales,
    paidPosSales,
    posPayments,
    paidPosPayments,
    posPaymentsMissingSale,
    unassignedPaidCashPayments,
    cashSessions,
    packageLedgers,
    clientPackages,
    guestQueuePending,
    guestQueueFailed,
    guestQueueStale,
    openingBalanceConflicts,
    adjustmentRequests,
    approvedNotApplied,
    appliedMissingLedger,
    opsCheckRuns,
    opsCheckAnomalies,
  ] = await Promise.all([
    countRows("pos_sales"),
    countRows("pos_sales", (query) => query.in("status", ["paid", "partially_refunded", "refunded"])),
    countRows("payments", (query) => query.eq("source", "pos_sale")),
    countRows("payments", (query) => query.eq("source", "pos_sale").eq("status", "paid")),
    countRows("payments", (query) => query.eq("source", "pos_sale").is("pos_sale_id", null)),
    countRows("payments", (query) =>
      query.eq("source", "pos_sale").eq("payment_method", "cash").eq("status", "paid").is("cash_session_id", null),
    ),
    countRows("pos_cash_sessions"),
    countRows("client_package_ledger_entries"),
    countRows("client_packages"),
    countRows("pkg02_guest_package_grant_queue", (query) => query.eq("status", "pending")),
    countRows("pkg02_guest_package_grant_queue", (query) => query.eq("status", "failed")),
    countRows("pkg02_guest_package_grant_queue", (query) => query.eq("status", "pending").lt("created_at", staleBefore)),
    countRows("pkg01_opening_balance_conflicts", (query) => query.eq("status", "open")),
    countRows("pkg02_adjustment_requests"),
    countRows("pkg02_adjustment_requests", (query) => query.eq("status", "approved")),
    countRows("pkg02_adjustment_requests", (query) => query.eq("status", "applied").is("applied_ledger_entry_id", null)),
    countRows("pkg02_ops_check_runs"),
    countRows("pkg02_ops_check_runs", (query) => query.eq("has_anomaly", true)),
  ]);

  let openSessionsQuery = admin
    .from("pos_cash_sessions")
    .select("studio_id, location_id")
    .eq("status", "open")
    .limit(5000);
  openSessionsQuery = scope(openSessionsQuery);
  const { data: openSessions, error: openSessionsError } = await openSessionsQuery;
  if (openSessionsError) throw new Error(`pos_cash_sessions open rows: ${describeError(openSessionsError)}`);

  const openSessionKeys = new Set();
  let duplicateOpenSessions = 0;
  for (const row of openSessions ?? []) {
    const key = `${row.studio_id}:${row.location_id}`;
    if (openSessionKeys.has(key)) duplicateOpenSessions += 1;
    openSessionKeys.add(key);
  }

  let paidSalesQuery = admin
    .from("pos_sales")
    .select("id")
    .in("status", ["paid", "partially_refunded", "refunded"])
    .limit(5000);
  paidSalesQuery = scope(paidSalesQuery);
  const { data: paidSalesRows, error: paidSalesError } = await paidSalesQuery;
  if (paidSalesError) throw new Error(`pos_sales payment links: ${describeError(paidSalesError)}`);

  let linkedPaymentsQuery = admin
    .from("payments")
    .select("pos_sale_id")
    .eq("source", "pos_sale")
    .not("pos_sale_id", "is", null)
    .limit(5000);
  linkedPaymentsQuery = scope(linkedPaymentsQuery);
  const { data: linkedPayments, error: linkedPaymentsError } = await linkedPaymentsQuery;
  if (linkedPaymentsError) throw new Error(`payments POS links: ${describeError(linkedPaymentsError)}`);
  const linkedSaleIds = new Set((linkedPayments ?? []).map((row) => row.pos_sale_id));
  const paidSalesMissingPayment = (paidSalesRows ?? []).filter((row) => !linkedSaleIds.has(row.id)).length;

  const { data: positiveClientPackages, error: positiveClientPackagesError } = await admin
    .from("client_packages")
    .select("id, client_id, package_id")
    .gt("credits_left", 0)
    .limit(5000);
  if (positiveClientPackagesError) {
    throw new Error(`client_packages positive balances: ${describeError(positiveClientPackagesError)}`);
  }

  let packageLedgerLinksQuery = admin
    .from("client_package_ledger_entries")
    .select("client_package_id")
    .limit(5000);
  packageLedgerLinksQuery = scope(packageLedgerLinksQuery);
  const { data: packageLedgerLinks, error: packageLedgerLinksError } = await packageLedgerLinksQuery;
  if (packageLedgerLinksError) {
    throw new Error(`client_package_ledger_entries links: ${describeError(packageLedgerLinksError)}`);
  }
  const ledgerClientPackageIds = new Set((packageLedgerLinks ?? []).map((row) => row.client_package_id));
  const positivePackagesMissingLedger = (positiveClientPackages ?? [])
    .filter((row) => !ledgerClientPackageIds.has(row.id)).length;

  const packageIds = [...new Set((positiveClientPackages ?? []).map((row) => row.package_id))];
  const clientIds = [...new Set((positiveClientPackages ?? []).map((row) => row.client_id))];
  const { data: packageRows, error: packageRowsError } = packageIds.length > 0
    ? await admin.from("packages").select("id, studio_id").in("id", packageIds)
    : { data: [], error: null };
  if (packageRowsError) throw new Error(`packages opening-balance mapping: ${describeError(packageRowsError)}`);
  const { data: customerRows, error: customerRowsError } = clientIds.length > 0
    ? await admin
        .from("salon_customers")
        .select("studio_id, user_id, merged_into_id")
        .in("user_id", clientIds)
        .is("merged_into_id", null)
    : { data: [], error: null };
  if (customerRowsError) throw new Error(`salon_customers opening-balance mapping: ${describeError(customerRowsError)}`);

  const packageStudioById = new Map((packageRows ?? []).map((row) => [row.id, row.studio_id]));
  let openingBalanceMappable = 0;
  let openingBalanceMissingCustomer = 0;
  let openingBalanceAmbiguousCustomer = 0;
  for (const clientPackage of positiveClientPackages ?? []) {
    if (ledgerClientPackageIds.has(clientPackage.id)) continue;
    const packageStudioId = packageStudioById.get(clientPackage.package_id);
    const matches = (customerRows ?? []).filter(
      (row) => row.user_id === clientPackage.client_id && row.studio_id === packageStudioId,
    );
    if (matches.length === 1) openingBalanceMappable += 1;
    else if (matches.length === 0) openingBalanceMissingCustomer += 1;
    else openingBalanceAmbiguousCustomer += 1;
  }

  let approvalsQuery = admin
    .from("pkg02_adjustment_requests")
    .select("maker_user_id, checker_user_id")
    .not("checker_user_id", "is", null)
    .limit(5000);
  approvalsQuery = scope(approvalsQuery);
  const { data: approvals, error: approvalsError } = await approvalsQuery;
  if (approvalsError) throw new Error(`pkg02_adjustment_requests role rows: ${describeError(approvalsError)}`);
  const selfApprovalCount = (approvals ?? []).filter((row) => row.maker_user_id === row.checker_user_id).length;

  const failures = [
    ...(paidSalesMissingPayment > 0 ? [`${paidSalesMissingPayment} paid/refunded POS sales have no payment link`] : []),
    ...(posPaymentsMissingSale > 0 ? [`${posPaymentsMissingSale} POS payments have no sale link`] : []),
    ...(duplicateOpenSessions > 0 ? [`${duplicateOpenSessions} duplicate open cash sessions found`] : []),
    ...(appliedMissingLedger > 0 ? [`${appliedMissingLedger} applied adjustments have no ledger link`] : []),
    ...(selfApprovalCount > 0 ? [`${selfApprovalCount} self-approved package adjustments found`] : []),
    ...(positivePackagesMissingLedger > 0
      ? [`${positivePackagesMissingLedger} positive-balance client packages have no ledger entry; opening-balance backfill is incomplete`]
      : []),
  ];

  const warnings = [
    ...(unassignedPaidCashPayments > 0
      ? [`${unassignedPaidCashPayments} paid POS cash payments are not assigned to a cash session (review legacy/pre-strict-mode rows)`]
      : []),
    ...(guestQueueFailed > 0 ? [`${guestQueueFailed} guest package grants are failed`] : []),
    ...(guestQueueStale > 0 ? [`${guestQueueStale} guest package grants have been pending for more than 24 hours`] : []),
    ...(approvedNotApplied > 0 ? [`${approvedNotApplied} package adjustments are approved but not applied`] : []),
    ...(opsCheckAnomalies > 0 ? [`${opsCheckAnomalies} persisted PKG-02 ops checks reported anomalies`] : []),
    ...(openingBalanceConflicts > 0 ? [`${openingBalanceConflicts} PKG-01 opening-balance conflicts remain open`] : []),
  ];

  console.log(JSON.stringify({
    ok: failures.length === 0,
    scope: studioId ? "single_studio" : "all_studios",
    counts: {
      posSales,
      paidOrRefundedPosSales: paidPosSales,
      posPayments,
      paidPosPayments,
      cashSessions,
      openCashSessions: openSessions?.length ?? 0,
      clientPackages,
      packageLedgerEntries: packageLedgers,
      positivePackagesMissingLedger,
      openingBalanceMappable,
      openingBalanceMissingCustomer,
      openingBalanceAmbiguousCustomer,
      openingBalanceConflicts,
      guestGrantQueuePending: guestQueuePending,
      packageAdjustmentRequests: adjustmentRequests,
      pkg02OpsCheckRuns: opsCheckRuns,
    },
    failures,
    warnings,
    note: "Read-only target preflight; browser role UAT and a real HitPay sandbox payment require dedicated fixtures and credentials.",
  }, null, 2));

  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-pos-pkg-target failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
