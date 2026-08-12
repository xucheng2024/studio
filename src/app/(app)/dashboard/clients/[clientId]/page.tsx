import { AlertTriangle, CheckCircle2, Circle, Lock, ShieldAlert } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import {
  createOrLinkTreatmentFromAppointmentAction,
  recordSalonCustomerEmailConsentAction,
  reviseTreatmentAction,
  upsertTreatmentFollowUpAction,
  updateMemberProfile,
  updateSalonCustomerHealthProfileAction,
  updateSalonCustomerPreferencesAction,
} from "@/app/(app)/dashboard/actions";
import { LocalDate } from "@/components/ui/LocalDate";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { getSalonCustomerSensitiveDetail, listSalonCustomersForDashboard } from "@/lib/salon-customer-sensitive";
import { listCustomerTreatments } from "@/lib/salon-treatments";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ location_id?: string; studio_id?: string }>;
};

type PaymentRow = {
  id: string;
  package_id: string | null;
  package_name_snapshot: string | null;
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  type: string | null;
  payment_method: string | null;
  reference_code: string | null;
  created_at: string | null;
};

type BookingRow = {
  id: string;
  status: string | null;
  created_at: string | null;
  checked_in_at: string | null;
  credit_consumed_at: string | null;
  client_package_id: string | null;
  class_sessions:
    | {
      start_time?: string | null;
      classes?: { title?: string | null; studio_id?: string | null } | { title?: string | null; studio_id?: string | null }[] | null;
    }
    | {
      start_time?: string | null;
      classes?: { title?: string | null; studio_id?: string | null } | { title?: string | null; studio_id?: string | null }[] | null;
    }[]
    | null;
};

function membershipStatusLabel(status: string | null | undefined) {
  if (status === "canceled") return "cancelled";
  return status ?? "scheduled";
}

export default async function ClientLedgerPage({ params, searchParams }: Props) {
  const { clientId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner", "manager", "frontdesk", "instructor"]);
  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to view this customer&apos;s ledger.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const admin = createAdminClient();
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");

  const listScope = await listSalonCustomersForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    locationId: selectedLocationId ?? null,
  });
  if (!listScope.ok) {
    return <p className={ui.muted}>You do not have access to this customer profile.</p>;
  }

  const resolvedSalonCustomer = listScope.customers.find(
    (row) => row.id === clientId || (row.user_id && row.user_id === clientId),
  );
  if (!resolvedSalonCustomer) {
    return <p className={ui.muted}>Customer not found in your authorized scope.</p>;
  }

  const salonCustomer = resolvedSalonCustomer;

  const ledgerUserId = salonCustomer.user_id;

  const [{ data: clientUser }, { data: profile }] = await Promise.all([
    ledgerUserId
      ? admin
          .from("users")
          .select("id, email")
          .eq("id", ledgerUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ledgerUserId
      ? admin
          .from("user_profiles")
          .select("full_name, phone, notes")
          .eq("id", ledgerUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sensitiveDetail = await getSalonCustomerSensitiveDetail({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    customerId: salonCustomer.id,
    locationId: selectedLocationId ?? null,
  });

  const treatmentResult = await listCustomerTreatments({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    customerId: salonCustomer.id,
    locationId: selectedLocationId ?? null,
  });

  const studioMembershipsForCrm02 = ctx.memberships.filter(
    (membership) =>
      membership.studio_id === activeStudioId
      && ["owner", "manager", "frontdesk", "instructor"].includes(membership.role),
  );

  const actorEmployeeIds = studioMembershipsForCrm02.some((membership) => membership.role === "instructor")
    ? ((await admin
        .from("employees")
        .select("id")
        .eq("studio_id", activeStudioId)
        .eq("user_id", user.id)
        .eq("employment_status", "active")).data ?? []).map((row) => row.id)
    : [];

  const hasNonInstructorScopeForLocation = (locationId: string) =>
    studioMembershipsForCrm02.some(
      (membership) =>
        (membership.role === "owner" || membership.role === "manager" || membership.role === "frontdesk")
        && (membership.location_id == null || membership.location_id === locationId),
    );

  const hasInstructorScopeForLocation = (locationId: string) =>
    studioMembershipsForCrm02.some(
      (membership) =>
        membership.role === "instructor"
        && (membership.location_id == null || membership.location_id === locationId),
    );

  const { data: completedAppointmentsRaw } = await admin
    .from("salon_appointments")
    .select("id, location_id, service_title_snapshot, starts_at, employee_name_snapshot, employee_id")
    .eq("studio_id", activeStudioId)
    .eq("salon_customer_id", salonCustomer.id)
    .eq("status", "completed")
    .order("starts_at", { ascending: false })
    .limit(30);

  const completedAppointments = (selectedLocationId
    ? (completedAppointmentsRaw ?? []).filter((row) => row.location_id === selectedLocationId)
    : (completedAppointmentsRaw ?? []))
    .filter((row) => {
      if (hasNonInstructorScopeForLocation(row.location_id)) return true;
      if (hasInstructorScopeForLocation(row.location_id)) {
        return actorEmployeeIds.includes(row.employee_id);
      }
      return false;
    }) as Array<{
      id: string;
      location_id: string;
      service_title_snapshot: string;
      starts_at: string;
      employee_name_snapshot: string;
      employee_id: string;
    }>;

  const { data: locationEmployeesRaw } = await admin
    .from("employees")
    .select("id, display_name, employee_locations!inner(location_id, studio_id, is_active)")
    .eq("studio_id", activeStudioId)
    .eq("employment_status", "active")
    .order("display_name");

  const locationEmployees = (locationEmployeesRaw ?? []).filter((row) => {
    if (!selectedLocationId) return true;
    const locations = Array.isArray(row.employee_locations) ? row.employee_locations : [row.employee_locations];
    return locations.some((item) => item?.location_id === selectedLocationId && item?.is_active);
  }) as Array<{ id: string; display_name: string }>;

  const { data: subscriptionsRaw } = ledgerUserId
    ? await admin
        .from("customer_subscriptions")
        .select("id, status, membership_name_snapshot, membership_price_snapshot, billing_interval_snapshot, created_at, canceled_at, current_period_end, cancel_at_period_end, cancel_requested_at, membership_products!inner(studio_id, location_id)")
        .eq("client_id", ledgerUserId)
        .eq("studio_id", activeStudioId)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] as const };

  const subscriptions = (selectedLocationId
    ? (subscriptionsRaw ?? []).filter((row) => {
        const membership = Array.isArray(row.membership_products) ? row.membership_products[0] : row.membership_products;
        return !membership?.location_id || membership.location_id === selectedLocationId;
      })
    : (subscriptionsRaw ?? [])) as Array<{
      id: string;
      status: string | null;
      membership_name_snapshot?: string | null;
      membership_price_snapshot?: number | null;
      billing_interval_snapshot?: string | null;
      created_at: string | null;
      current_period_end?: string | null;
      cancel_at_period_end?: boolean | null;
      cancel_requested_at?: string | null;
      canceled_at?: string | null;
    }>;

  const { data: packRowsRaw } = ledgerUserId
    ? await admin
        .from("client_packages")
        .select("id, package_id, credits_left, expiry_date, package_name_snapshot, package_credits_snapshot, packages!inner(studio_id, location_id)")
        .eq("client_id", ledgerUserId)
        .in("packages.studio_id", [activeStudioId])
    : { data: [] as const };

  // When a location is selected, only show packages that are either studio-wide
  // (location_id = null) or specifically belong to that location.
  const packRows = selectedLocationId
    ? (packRowsRaw ?? []).filter((r) => {
        const pkg = r.packages as { location_id?: string | null } | { location_id?: string | null }[] | null;
        const locId = Array.isArray(pkg) ? pkg[0]?.location_id : pkg?.location_id;
        return !locId || locId === selectedLocationId;
      })
    : (packRowsRaw ?? []);

  let paymentRows: PaymentRow[] = [];
  if (ledgerUserId) {
    let payQ = admin
      .from("payments")
      .select("id, package_id, package_name_snapshot, amount, paid_amount, status, type, payment_method, reference_code, created_at")
      .eq("client_id", ledgerUserId)
      .eq("studio_id", activeStudioId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (selectedLocationId) payQ = payQ.eq("location_id", selectedLocationId);
    const payRes = await payQ;
    paymentRows = payRes.data ?? [];
  }

  let bookingRows: BookingRow[] = [];
  if (ledgerUserId) {
    let bookingQ = admin
      .from("bookings")
      .select(
        "id, status, created_at, checked_in_at, credit_consumed_at, client_package_id, class_sessions!inner(start_time, classes!inner(title, studio_id))",
      )
      .eq("client_id", ledgerUserId)
      .in("class_sessions.classes.studio_id", [activeStudioId])
      .order("created_at", { ascending: false })
      .limit(400);
    if (selectedLocationId) bookingQ = bookingQ.eq("class_sessions.location_id", selectedLocationId);
    const bookingRes = await bookingQ;
    bookingRows = bookingRes.data ?? [];
  }

  const balanceTotal = (packRows ?? []).reduce((sum, row) => sum + Number(row.credits_left ?? 0), 0);
  const purchaseRows = (paymentRows ?? []).filter((p) => p.type === "package");
  const usageRows = (bookingRows ?? []).filter((b) => Boolean(b.client_package_id));

  const backParams = new URLSearchParams();
  backParams.set("studio_id", activeStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);

  const statusColors: Record<string, string> = {
    paid: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60",
    pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
    failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
    refunded: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  };

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
      {/* ── Header ──────────────────────────────────────────────── */}
      <div>
        <DashboardAppLink href={`/dashboard/clients?${backParams.toString()}`} className={`${ui.btnSecondarySm} mb-3`}>
          ← Customers
        </DashboardAppLink>
        <h1 className={ui.h1}>Package ledger</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {salonCustomer.email ?? clientUser?.email ?? salonCustomer.phone ?? salonCustomer.id}
        </p>
        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 dark:border-teal-800/60 dark:bg-teal-950/40`}>
          <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">{balanceTotal}</span>
          <span className={`text-xs ${ui.muted}`}>class passes available</span>
        </div>
      </div>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={ui.h2}>Customer profile</h2>
        </div>
        {ledgerUserId ? (
          <ServerActionToastForm action={updateMemberProfile} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="studio_id" value={activeStudioId} />
            {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
            <input type="hidden" name="client_id" value={ledgerUserId} />
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Full name</span>
              <input
                name="full_name"
                type="text"
                defaultValue={(profile as { full_name?: string | null } | null)?.full_name ?? salonCustomer.full_name ?? ""}
                className={ui.input}
                placeholder="Customer name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Phone</span>
              <FormPhoneField name="phone" defaultValue={(profile as { phone?: string | null } | null)?.phone ?? salonCustomer.phone ?? ""} />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={ui.label}>Notes</span>
              <textarea
                name="notes"
                defaultValue={(profile as { notes?: string | null } | null)?.notes ?? ""}
                className={ui.input}
                rows={4}
                placeholder="Internal notes for operations (e.g. injury, preference, follow-up)."
                maxLength={1000}
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={ui.btnPrimarySm}>Save profile</button>
            </div>
          </ServerActionToastForm>
        ) : (
          <div className="mt-3 grid gap-2 text-sm">
            <p className={ui.muted}>This customer is a walk-in record without a linked member account.</p>
            <p className={ui.muted}>Name: <span className="font-medium text-stone-800 dark:text-stone-200">{salonCustomer.full_name}</span></p>
            <p className={ui.muted}>Email: <span className="font-medium text-stone-800 dark:text-stone-200">{salonCustomer.email ?? "—"}</span></p>
            <p className={ui.muted}>Phone: <span className="font-medium text-stone-800 dark:text-stone-200">{salonCustomer.phone ?? "—"}</span></p>
          </div>
        )}
      </section>

      <section>
        <h2 className={ui.h2}>Membership subscription</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {subscriptions.map((subscription) => {
            const displayStatus = getMembershipDisplayStatus(subscription);
            const tone =
              displayStatus === "active"
                ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                : displayStatus === "retrying"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  : displayStatus === "ending"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400";
            const intervalLabel = subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly";
            return (
              <li key={subscription.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {subscription.membership_name_snapshot?.trim() || "Membership"}
                    </p>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} · {intervalLabel}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
                    {membershipStatusLabel(displayStatus)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {subscription.created_at ? (
                    <span>Started <LocalDate iso={subscription.created_at} /></span>
                  ) : null}
                  {subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription) ? (
                    <span>Active until <LocalDate iso={subscription.current_period_end} /></span>
                  ) : null}
                  {displayStatus === "canceled" && subscription.canceled_at ? (
                    <span>Ended <LocalDate iso={subscription.canceled_at} /></span>
                  ) : (
                    <span>{subscription.cancel_at_period_end ? "No further renewals scheduled" : "Auto-renews until cancelled"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!subscriptions.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No membership subscription.</p>
          </div>
        ) : null}
      </section>

      {/* ── Current packages ────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Current packages</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {(packRows ?? []).map((row) => {
            const packageName =
              (row as { package_name_snapshot?: string | null }).package_name_snapshot?.trim() || "Package";
            const packageCredits = Number((row as { package_credits_snapshot?: number | null }).package_credits_snapshot ?? 0);
            const pct = packageCredits > 0 ? Math.round((row.credits_left / packageCredits) * 100) : null;
            return (
              <li key={row.id} className={`${ui.card} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">{packageName}</p>
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    Expiry: {row.expiry_date ? <LocalDate iso={row.expiry_date} /> : "No expiry"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pct !== null && (
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                    {row.credits_left}
                    <span className={`font-normal ${ui.muted}`}> / {packageCredits || "?"}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!packRows?.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No active packages.</p>
          </div>
        ) : null}
      </section>

      {/* ── Package purchases ────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Package purchases</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {purchaseRows.map((p) => {
            const statusCls = statusColors[p.status ?? ""] ?? statusColors.pending;
            const packageName = p.package_name_snapshot?.trim() || null;
            return (
              <li key={p.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    ${(Number(p.paid_amount ?? p.amount ?? 0)).toFixed(2)}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                    {p.status ?? "-"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {p.payment_method ? <span>{p.payment_method}</span> : null}
                  {p.reference_code ? <span>Ref: {p.reference_code}</span> : null}
                  {p.created_at ? <span><LocalTime iso={p.created_at} /></span> : null}
                </div>
                {packageName ? <p className={`mt-1 text-sm ${ui.muted}`}>Package: {packageName}</p> : null}
              </li>
            );
          })}
        </ul>
        {!purchaseRows.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No purchase records.</p>
          </div>
        ) : null}
      </section>

      {/* ── Class pass usage ─────────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Class pass usage</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {usageRows.map((b) => {
            const sessionObj = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
            const clsObj = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
            const checkedIn = Boolean(b.checked_in_at);
            const creditUsed = Boolean(b.credit_consumed_at);
            return (
              <li key={b.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {clsObj?.title ?? "Class"}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    b.status === "booked" || b.status === "attended"
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                      : b.status === "cancelled" || b.status === "no_show"
                        ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}>
                    {(b.status ?? "scheduled").replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {sessionObj?.start_time ? (
                    <span><LocalTime iso={String(sessionObj.start_time)} /></span>
                  ) : null}
                  <span className="flex items-center gap-1">
                    {checkedIn
                      ? <CheckCircle2 size={11} className="text-teal-500" />
                      : <Circle size={11} className="text-stone-400" />}
                    {checkedIn ? "Checked in" : "Not checked in"}
                  </span>
                  <span className="flex items-center gap-1">
                    {creditUsed
                      ? <CheckCircle2 size={11} className="text-teal-500" />
                      : <Circle size={11} className="text-stone-400" />}
                    {creditUsed ? "Class pass used" : "Class pass pending"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!usageRows.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No package-based bookings yet.</p>
          </div>
        ) : null}
      </section>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={ui.h2}>Treatments / Follow-up</h2>
            <p className={`mt-1 text-xs ${ui.muted}`}>CRM-02 keeps treatment revisions and due-date follow-up queue in studio scope.</p>
          </div>
          <DashboardAppLink
            href={`/dashboard/clients/follow-ups?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnSecondarySm}
          >
            Open follow-up queue
          </DashboardAppLink>
        </div>

        <ServerActionToastForm action={createOrLinkTreatmentFromAppointmentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={activeStudioId} />
          <input type="hidden" name="customer_id" value={salonCustomer.id} />
          <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Completed appointment</span>
            <select name="appointment_id" className={ui.select} required defaultValue="">
              <option value="" disabled>Select completed appointment</option>
              {completedAppointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {appointment.service_title_snapshot} · {appointment.employee_name_snapshot} · {appointment.starts_at.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Lifecycle status</span>
            <select name="lifecycle_status" className={ui.select} defaultValue="open">
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Actual service employee (optional override)</span>
            <select name="actual_employee_id" className={ui.select} defaultValue="">
              <option value="">Use appointment employee</option>
              {locationEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.display_name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Revision reason</span>
            <input name="revision_reason" className={ui.input} placeholder="e.g. initial_record" />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Note summary (non-sensitive)</span>
            <textarea name="note_summary" rows={2} className={ui.input} />
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Sensitive treatment note</span>
            <textarea name="sensitive_note_body" rows={3} className={ui.input} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Follow-up due date (optional)</span>
            <input name="follow_up_due_on" type="date" className={ui.input} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Follow-up owner (optional)</span>
            <select name="follow_up_owner_employee_id" className={ui.select} defaultValue="">
              <option value="">Unassigned</option>
              {locationEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.display_name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Follow-up note (non-sensitive)</span>
            <textarea name="follow_up_note_summary" rows={2} className={ui.input} />
          </label>

          <div className="sm:col-span-2">
            <button type="submit" className={ui.btnPrimarySm}>Create / link treatment</button>
          </div>
        </ServerActionToastForm>

        {!treatmentResult.ok ? (
          <p className={`mt-3 text-sm ${ui.muted}`}>Treatment data is outside your authorized CRM-02 scope.</p>
        ) : treatmentResult.rows.length === 0 ? (
          <p className={`mt-3 text-sm ${ui.muted}`}>No treatments yet for this customer in current scope.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {treatmentResult.rows.map((row) => (
              <article key={row.treatment.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-3 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{row.treatment.service_title_snapshot}</p>
                    <p className={`text-xs ${ui.muted}`}>
                      employee: {row.treatment.actual_employee_name_snapshot} · appointment: {row.treatment.appointment_id.slice(0, 8)} · status: {row.treatment.lifecycle_status}
                    </p>
                  </div>
                  <p className={`text-xs ${ui.muted}`}><LocalTime iso={row.treatment.created_at} /></p>
                </div>

                <div className="mt-2 rounded-lg border border-stone-200/80 bg-stone-50/70 px-2.5 py-2 dark:border-stone-700 dark:bg-stone-900/40">
                  <p className="text-xs font-medium text-stone-800 dark:text-stone-200">Latest revision</p>
                  <p className={`mt-1 text-xs ${ui.muted}`}>
                    {row.latestRevision
                      ? `#${row.latestRevision.revision_no} · ${row.latestRevision.lifecycle_status} · ${row.latestRevision.revision_reason ?? "no_reason"}`
                      : "No revision details."}
                  </p>
                  <p className={`mt-1 text-xs ${ui.muted}`}>{row.latestRevision?.note_summary ?? "No non-sensitive summary."}</p>
                </div>

                <ServerActionToastForm action={reviseTreatmentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="studio_id" value={activeStudioId} />
                  <input type="hidden" name="customer_id" value={salonCustomer.id} />
                  <input type="hidden" name="treatment_id" value={row.treatment.id} />
                  <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />

                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Lifecycle</span><select name="lifecycle_status" className={ui.select} defaultValue={row.treatment.lifecycle_status}><option value="open">Open</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label>
                  <label className="flex flex-col gap-1.5"><span className={ui.label}>Revision reason</span><input name="revision_reason" className={ui.input} /></label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Note summary (non-sensitive)</span><textarea name="note_summary" rows={2} className={ui.input} /></label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Sensitive treatment note</span><textarea name="sensitive_note_body" rows={2} className={ui.input} /></label>
                  <div className="sm:col-span-2"><button type="submit" className={ui.btnSecondarySm}>Add revision</button></div>
                </ServerActionToastForm>

                <div className="mt-3 flex flex-col gap-2">
                  {row.followUps.map((followUp) => (
                    <ServerActionToastForm key={followUp.id} action={upsertTreatmentFollowUpAction} className="rounded-lg border border-stone-200/80 bg-stone-50/60 px-2.5 py-2 dark:border-stone-700 dark:bg-stone-900/40">
                      <input type="hidden" name="studio_id" value={activeStudioId} />
                      <input type="hidden" name="customer_id" value={salonCustomer.id} />
                      <input type="hidden" name="treatment_id" value={row.treatment.id} />
                      <input type="hidden" name="follow_up_id" value={followUp.id} />
                      <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5"><span className={ui.label}>Due date</span><input name="due_on" type="date" defaultValue={followUp.due_on} className={ui.input} /></label>
                        <label className="flex flex-col gap-1.5"><span className={ui.label}>Status</span><select name="status" defaultValue={followUp.status} className={ui.select}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
                        <label className="flex flex-col gap-1.5"><span className={ui.label}>Owner</span><select name="owner_employee_id" defaultValue={followUp.owner_employee_id ?? ""} className={ui.select}><option value="">Unassigned</option>{locationEmployees.map((employee) => (<option key={employee.id} value={employee.id}>{employee.display_name}</option>))}</select></label>
                        <label className="flex flex-col gap-1.5"><span className={ui.label}>Note (non-sensitive)</span><input name="note_summary" defaultValue={followUp.note_summary ?? ""} className={ui.input} /></label>
                      </div>
                      <button type="submit" className={`${ui.btnGhost} mt-2`}>Save follow-up</button>
                    </ServerActionToastForm>
                  ))}

                  <ServerActionToastForm action={upsertTreatmentFollowUpAction} className="rounded-lg border border-dashed border-stone-300 px-2.5 py-2 dark:border-stone-700">
                    <input type="hidden" name="studio_id" value={activeStudioId} />
                    <input type="hidden" name="customer_id" value={salonCustomer.id} />
                    <input type="hidden" name="treatment_id" value={row.treatment.id} />
                    <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>New due date</span><input name="due_on" type="date" className={ui.input} /></label>
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>Owner</span><select name="owner_employee_id" className={ui.select} defaultValue=""><option value="">Unassigned</option>{locationEmployees.map((employee) => (<option key={employee.id} value={employee.id}>{employee.display_name}</option>))}</select></label>
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>Status</span><select name="status" className={ui.select} defaultValue="pending"><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>Note (non-sensitive)</span><input name="note_summary" className={ui.input} /></label>
                    </div>
                    <button type="submit" className={`${ui.btnSecondarySm} mt-2`}>Add follow-up</button>
                  </ServerActionToastForm>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {sensitiveDetail.ok ? (
        <>
          <section className={`${ui.card} border-amber-200/60 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/25`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 text-amber-600 dark:text-amber-400" size={16} />
              <div>
                <h2 className={`${ui.h2} text-amber-900 dark:text-amber-100`}>Sensitive Information Notice</h2>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Health & safety data is sensitive. Access is role-scoped, audited, and must only be used for service safety.
                </p>
              </div>
            </div>
          </section>

          <section className={ui.card}>
            <h2 className={ui.h2}>Preferences</h2>
            <ServerActionToastForm action={updateSalonCustomerPreferencesAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              <input type="hidden" name="customer_id" value={salonCustomer.id} />
              {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Preferred services</span>
                <textarea name="preferred_services" defaultValue={sensitiveDetail.detail.preferences?.preferred_services ?? ""} className={ui.input} rows={2} />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Preferred employee IDs (comma-separated UUID)</span>
                <input name="preferred_employee_ids" defaultValue={(sensitiveDetail.detail.preferences?.preferred_employee_ids ?? []).join(", ")} className={ui.input} placeholder="uuid, uuid" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Preferred location IDs (comma-separated UUID)</span>
                <input name="preferred_location_ids" defaultValue={(sensitiveDetail.detail.preferences?.preferred_location_ids ?? []).join(", ")} className={ui.input} placeholder="uuid, uuid" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Preferred time slots</span>
                <input name="preferred_time_slots" defaultValue={(sensitiveDetail.detail.preferences?.preferred_time_slots ?? []).join(", ")} className={ui.input} placeholder="Weekday AM, Weekend PM" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Communication language</span>
                <input name="communication_language" defaultValue={sensitiveDetail.detail.preferences?.communication_language ?? ""} className={ui.input} placeholder="English / 中文" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Contact preference</span>
                <input name="contact_preference" defaultValue={sensitiveDetail.detail.preferences?.contact_preference ?? ""} className={ui.input} placeholder="Email / Call / Frontdesk" />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Product preferences</span>
                <textarea name="product_preferences" defaultValue={sensitiveDetail.detail.preferences?.product_preferences ?? ""} className={ui.input} rows={2} />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Environment preferences</span>
                <textarea name="environment_preferences" defaultValue={sensitiveDetail.detail.preferences?.environment_preferences ?? ""} className={ui.input} rows={2} />
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Service notes</span>
                <textarea name="preference_notes" defaultValue={sensitiveDetail.detail.preferences?.notes ?? ""} className={ui.input} rows={3} />
              </label>

              <div className="sm:col-span-2">
                <button type="submit" className={ui.btnPrimarySm}>Save preferences</button>
              </div>
            </ServerActionToastForm>
          </section>

          <section className={ui.card}>
            <h2 className={ui.h2}>Health & Safety</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {sensitiveDetail.detail.safety.hasHealthAlert ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  <AlertTriangle size={12} />
                  Safety alert exists
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                  <ShieldAlert size={12} />
                  No active safety alert
                </span>
              )}
            </div>
            <ServerActionToastForm action={updateSalonCustomerHealthProfileAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              <input type="hidden" name="customer_id" value={salonCustomer.id} />
              {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}

              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Allergies</span><textarea name="allergies" defaultValue={sensitiveDetail.detail.health?.allergies ?? ""} className={ui.input} rows={2} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Reaction ingredients</span><textarea name="reaction_ingredients" defaultValue={sensitiveDetail.detail.health?.reaction_ingredients ?? ""} className={ui.input} rows={2} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Reaction products</span><textarea name="reaction_products" defaultValue={sensitiveDetail.detail.health?.reaction_products ?? ""} className={ui.input} rows={2} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Declared health conditions</span><textarea name="declared_health_conditions" defaultValue={sensitiveDetail.detail.health?.declared_health_conditions ?? ""} className={ui.input} rows={2} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Pregnancy / service-affecting conditions</span><textarea name="service_affecting_conditions" defaultValue={sensitiveDetail.detail.health?.service_affecting_conditions ?? ""} className={ui.input} rows={2} /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Contraindications</span><textarea name="contraindications" defaultValue={sensitiveDetail.detail.health?.contraindications ?? ""} className={ui.input} rows={2} /></label>

              <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test required</span><select name="patch_test_required" className={ui.select} defaultValue={sensitiveDetail.detail.health?.patch_test_required ? "true" : "false"}><option value="false">No</option><option value="true">Yes</option></select></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test date</span><input name="patch_test_date" type="date" className={ui.input} defaultValue={sensitiveDetail.detail.health?.patch_test_date ?? ""} /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test result</span><select name="patch_test_result" className={ui.select} defaultValue={sensitiveDetail.detail.health?.patch_test_result ?? ""}><option value="">Select</option><option value="pending">Pending</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="not_required">Not required</option></select></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Last confirmed at (ISO datetime)</span><input name="last_confirmed_at" className={ui.input} defaultValue={sensitiveDetail.detail.health?.last_confirmed_at ?? ""} placeholder="2026-08-12T10:00:00+08:00" /></label>

              <div className="sm:col-span-2"><button type="submit" className={ui.btnPrimarySm}>Save health & safety</button></div>
            </ServerActionToastForm>
          </section>

          <section className={ui.card}>
            <h2 className={ui.h2}>Consents</h2>
            <p className={`mt-1 text-xs ${ui.muted}`}>CRM-01 currently supports Email Marketing consent only.</p>
            <ServerActionToastForm action={recordSalonCustomerEmailConsentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              <input type="hidden" name="customer_id" value={salonCustomer.id} />
              {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />

              <label className="flex flex-col gap-1.5"><span className={ui.label}>Consent status</span><select name="consent_status" className={ui.select} defaultValue="granted"><option value="granted">Granted</option><option value="withdrawn">Withdrawn</option></select></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Source</span><select name="consent_source" className={ui.select} defaultValue="frontdesk"><option value="frontdesk">Frontdesk</option><option value="imported">Imported</option><option value="api">API</option><option value="system">System</option></select></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Consent text version</span><input name="consent_text_version" className={ui.input} placeholder="email-marketing-v1.0" required /></label>
              <label className="flex flex-col gap-1.5"><span className={ui.label}>Occurred at (optional ISO datetime)</span><input name="consent_occurred_at" className={ui.input} placeholder="2026-08-12T10:00:00+08:00" /></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Evidence note</span><textarea name="consent_evidence_note" className={ui.input} rows={2} /></label>
              <div className="sm:col-span-2"><button type="submit" className={ui.btnPrimarySm}>Record consent event</button></div>
            </ServerActionToastForm>

            <ul className="mt-4 flex flex-col gap-2">
              {sensitiveDetail.detail.consents.map((event) => (
                <li key={event.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{event.status}</span>
                    <span className={`text-xs ${ui.muted}`}><LocalTime iso={event.occurred_at} /></span>
                  </div>
                  <p className={`mt-1 text-xs ${ui.muted}`}>source: {event.source} · text: {event.text_version} · actor role: {event.actor_role}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={ui.card}>
            <div className="flex items-center gap-2"><Lock size={15} className="text-stone-500" /><h2 className={ui.h2}>Sensitive Access Audit</h2></div>
            {sensitiveDetail.detail.canViewSensitiveAudit ? (
              <ul className="mt-3 flex flex-col gap-2">
                {sensitiveDetail.detail.accessAudits.map((audit) => (
                  <li key={audit.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{audit.action}</span>
                      <span className={`text-xs ${ui.muted}`}><LocalTime iso={audit.created_at} /></span>
                    </div>
                    <p className={`mt-1 text-xs ${ui.muted}`}>actor role: {audit.actor_role}{audit.location_id ? ` · location: ${audit.location_id}` : ""}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`mt-2 text-sm ${ui.muted}`}>You are authorised to view sensitive data, but not the full access audit trail.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
