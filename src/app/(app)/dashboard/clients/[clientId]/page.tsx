import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ClientAppointmentsSection, type CustomerAppointmentRow } from "@/components/dashboard/client-profile/appointments-section";
import { ClientAuditSection } from "@/components/dashboard/client-profile/audit-section";
import { ClientConsentSection } from "@/components/dashboard/client-profile/consent-section";
import { ClientFollowUpSection } from "@/components/dashboard/client-profile/follow-up-section";
import { ClientHealthSection } from "@/components/dashboard/client-profile/health-section";
import { ClientOverviewSection } from "@/components/dashboard/client-profile/overview-section";
import { ClientPurchasesSection } from "@/components/dashboard/client-profile/purchases-section";
import { ClientProfileSectionNav, parseClientProfileSection } from "@/components/dashboard/client-profile/section-nav";
import { ClientTreatmentsSection } from "@/components/dashboard/client-profile/treatments-section";
import {
  anonymizeSalonCustomerAction,
  createSalonCustomerDataRequestAction,
  recordSalonCustomerPrivacyConsentAction,
  updateMemberProfile,
  updateSalonCustomerCoreProfileAction,
} from "@/app/(app)/dashboard/actions";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { listPosSalesForDashboard } from "@/lib/pos-sales-read";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { getSalonCustomerSensitiveDetail, listSalonCustomersForDashboard } from "@/lib/salon-customer-sensitive";
import { getLatestPrivacyNotice } from "@/lib/studio-privacy";
import { listCustomerTreatments } from "@/lib/salon-treatments";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ location_id?: string; studio_id?: string; section?: string }>;
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

const UPCOMING_APPOINTMENT_STATUSES = new Set(["pending", "confirmed", "checked_in", "in_progress"]);

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
    return <p className={ui.muted}>Select a studio in the left sidebar to view this customer.</p>;
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
  const activeSection = parseClientProfileSection(sp.section);

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

  const privacyNotice = await getLatestPrivacyNotice({ studioId: activeStudioId });
  const isAnonymized = Boolean(salonCustomer.anonymized_at);
  const canAnonymize = Boolean(sensitiveDetail.ok && sensitiveDetail.detail.canAnonymize && !isAnonymized);

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

  const { data: appointmentsRaw } = await admin
    .from("salon_appointments")
    .select("id, location_id, service_title_snapshot, starts_at, employee_name_snapshot, employee_id, status, location_name_snapshot")
    .eq("studio_id", activeStudioId)
    .eq("salon_customer_id", salonCustomer.id)
    .order("starts_at", { ascending: false })
    .limit(80);

  const scopedAppointments = (selectedLocationId
    ? (appointmentsRaw ?? []).filter((row) => row.location_id === selectedLocationId)
    : (appointmentsRaw ?? []))
    .filter((row) => {
      if (hasNonInstructorScopeForLocation(row.location_id)) return true;
      if (hasInstructorScopeForLocation(row.location_id)) {
        return actorEmployeeIds.includes(row.employee_id);
      }
      return false;
    }) as CustomerAppointmentRow[];

  const nowIso = new Date().toISOString();
  const upcomingAppointments = scopedAppointments
    .filter((row) => UPCOMING_APPOINTMENT_STATUSES.has(row.status) && row.starts_at >= nowIso)
    .slice()
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  const historyAppointments = scopedAppointments.filter(
    (row) => !(UPCOMING_APPOINTMENT_STATUSES.has(row.status) && row.starts_at >= nowIso),
  );
  const completedAppointments = scopedAppointments.filter((row) => row.status === "completed");

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

  const posResult = await listPosSalesForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    locationId: selectedLocationId ?? null,
    salonCustomerId: salonCustomer.id,
    limit: 20,
  });
  const posSales = posResult.ok ? posResult.sales : [];

  const balanceTotal = (packRows ?? []).reduce((sum, row) => sum + Number(row.credits_left ?? 0), 0);
  const purchaseRows = (paymentRows ?? []).filter((p) => p.type === "package");
  const usageRows = (bookingRows ?? []).filter((b) => Boolean(b.client_package_id));
  const pendingFollowUps = treatmentResult.ok
    ? treatmentResult.rows.flatMap((row) => row.followUps).filter((item) => item.status === "pending" || item.status === "in_progress")
    : [];
  const nextAppointment = upcomingAppointments[0] ?? null;
  const safety = sensitiveDetail.ok ? sensitiveDetail.detail.safety : {
    hasHealthAlert: false,
    hasAllergyAlert: false,
    hasContraindicationAlert: false,
    patchTestRequired: false,
    lastConfirmedAt: null,
  };
  const consents = sensitiveDetail.ok ? sensitiveDetail.detail.consents : [];

  const backParams = new URLSearchParams();
  backParams.set("studio_id", activeStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
  const sectionHref = (section: string) => {
    const params = new URLSearchParams(backParams);
    if (section !== "overview") params.set("section", section);
    return `/dashboard/clients/${salonCustomer.id}?${params.toString()}`;
  };
  const approvalsBaseHref = `/dashboard/packages/approvals?${backParams.toString()}`;
  const appointmentsHref = `/dashboard/appointments?${backParams.toString()}`;
  const posHref = `/dashboard/pos?${backParams.toString()}`;
  const followUpQueueHref = `/dashboard/clients/follow-ups?${backParams.toString()}`;
  const profileScope = {
    studioId: activeStudioId,
    customerId: salonCustomer.id,
    locationId: selectedLocationId ?? null,
  };
  const displayName = salonCustomer.full_name?.trim() || profile?.full_name?.trim() || "Customer";
  const displayEmail = salonCustomer.email ?? clientUser?.email ?? "";
  const displayPhone = salonCustomer.phone ?? "";
  const preferredLocationName = (locationRows ?? []).find((row) => row.id === salonCustomer.preferred_location_id)?.name ?? null;

  void anonymizeSalonCustomerAction;
  void createSalonCustomerDataRequestAction;
  void recordSalonCustomerPrivacyConsentAction;
  void updateSalonCustomerCoreProfileAction;

  return (
    <div className="flex flex-col gap-6">
      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locationRows ?? []}
          selectedStudioId={activeStudioId}
          selectedLocationId={selectedLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />
      </div>

      <div className="sticky top-0 z-20 -mx-1 border-b border-stone-200/80 bg-white/95 px-1 py-3 backdrop-blur dark:border-stone-800/80 dark:bg-stone-950/95">
        <DashboardAppLink href={`/dashboard/clients?${backParams.toString()}`} className={`${ui.btnGhost} mb-2`}>
          ← Customers
        </DashboardAppLink>
        <h1 className={ui.h1}>{displayName}</h1>
        <p className={`mt-1 ${ui.muted}`}>{displayEmail || displayPhone || salonCustomer.id}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={ui.badge}>{balanceTotal} class passes</span>
          {safety.hasHealthAlert ? <span className={ui.badgeAmber}>Safety alert</span> : null}
          {pendingFollowUps.length > 0 ? <span className={ui.badgeAmber}>{pendingFollowUps.length} follow-ups</span> : null}
          {isAnonymized ? <span className={ui.badgeNeutral}>Anonymized</span> : <span className={ui.badgeNeutral}>{salonCustomer.status}</span>}
        </div>
        <ClientProfileSectionNav
          activeSection={activeSection}
          hrefFor={sectionHref}
          healthAlert={safety.hasHealthAlert}
          pendingFollowUps={pendingFollowUps.length}
        />
      </div>

      {activeSection === "overview" ? (
        <ClientOverviewSection
          scope={profileScope}
          customerName={salonCustomer.full_name ?? ""}
          customerEmail={salonCustomer.email ?? ""}
          customerPhone={salonCustomer.phone ?? ""}
          customerStatus={salonCustomer.status}
          customerSource={salonCustomer.source}
          preferredLocationName={preferredLocationName}
          isAnonymized={isAnonymized}
          canAnonymize={canAnonymize}
          showPreferences={sensitiveDetail.ok}
          preferences={sensitiveDetail.ok ? sensitiveDetail.detail.preferences : null}
          locations={(locationRows ?? []).map((row) => ({ id: row.id, name: row.name }))}
          employees={locationEmployees}
          nextAppointmentLabel={nextAppointment ? `${nextAppointment.service_title_snapshot} · ${formatLocalDateTime(nextAppointment.starts_at)}` : null}
          pendingFollowUps={pendingFollowUps.length}
          packageBalance={balanceTotal}
          consents={consents}
          hasHealthAlert={safety.hasHealthAlert}
          appointmentsHref={appointmentsHref}
          posHref={posHref}
          followUpQueueHref={followUpQueueHref}
          approvalsHref={approvalsBaseHref}
          notesForm={ledgerUserId && !isAnonymized ? (
            <ServerActionToastForm action={updateMemberProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
              <input type="hidden" name="client_id" value={ledgerUserId} />
              <input type="hidden" name="full_name" value={salonCustomer.full_name ?? ""} />
              <input type="hidden" name="phone" value={salonCustomer.phone ?? ""} />
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Internal notes</span>
                <textarea
                  name="notes"
                  defaultValue={(profile as { notes?: string | null } | null)?.notes ?? ""}
                  className={ui.input}
                  rows={3}
                  placeholder="Internal notes for operations."
                  maxLength={1000}
                />
              </label>
              <div className="sm:col-span-2"><button type="submit" className={ui.btnSecondarySm}>Save notes</button></div>
            </ServerActionToastForm>
          ) : null}
        />
      ) : null}

      {activeSection === "health" && sensitiveDetail.ok ? (
        <ClientHealthSection scope={profileScope} safety={safety} health={sensitiveDetail.detail.health} />
      ) : null}
      {activeSection === "health" && !sensitiveDetail.ok ? (
        <p className={ui.muted}>Health data is outside your authorized scope.</p>
      ) : null}

      {activeSection === "appointments" ? (
        <ClientAppointmentsSection
          upcoming={upcomingAppointments}
          history={historyAppointments}
          calendarHref={appointmentsHref}
        />
      ) : null}

      {activeSection === "treatments" ? (
        <ClientTreatmentsSection
          scope={profileScope}
          completedAppointments={completedAppointments}
          employees={locationEmployees}
          treatmentResult={treatmentResult}
        />
      ) : null}

      {activeSection === "purchases" ? (
        <ClientPurchasesSection
          subscriptions={subscriptions}
          packages={packRows as Array<{
            id: string;
            credits_left: number;
            expiry_date: string | null;
            package_name_snapshot?: string | null;
            package_credits_snapshot?: number | null;
          }>}
          purchases={purchaseRows}
          usage={usageRows}
          posSales={posSales}
          scopeParams={backParams.toString()}
        />
      ) : null}

      {activeSection === "follow-up" ? (
        <ClientFollowUpSection
          scope={profileScope}
          treatmentResult={treatmentResult}
          employees={locationEmployees}
          queueHref={followUpQueueHref}
        />
      ) : null}

      {activeSection === "consent" && sensitiveDetail.ok ? (
        <ClientConsentSection
          scope={profileScope}
          isAnonymized={isAnonymized}
          privacyNotice={privacyNotice ? { id: privacyNotice.id, version_label: privacyNotice.version_label } : null}
          consents={consents}
        />
      ) : null}
      {activeSection === "consent" && !sensitiveDetail.ok ? (
        <p className={ui.muted}>Consent data is outside your authorized scope.</p>
      ) : null}

      {activeSection === "audit" && sensitiveDetail.ok ? (
        <ClientAuditSection
          scope={profileScope}
          isAnonymized={isAnonymized}
          customerName={salonCustomer.full_name ?? ""}
          customerEmail={salonCustomer.email ?? ""}
          customerPhone={salonCustomer.phone ?? ""}
          dataRequests={sensitiveDetail.detail.dataRequests}
          accessAudits={sensitiveDetail.detail.accessAudits}
          canViewSensitiveAudit={sensitiveDetail.detail.canViewSensitiveAudit}
        />
      ) : null}
      {activeSection === "audit" && !sensitiveDetail.ok ? (
        <p className={ui.muted}>Audit data is outside your authorized scope.</p>
      ) : null}
    </div>
  );
}
