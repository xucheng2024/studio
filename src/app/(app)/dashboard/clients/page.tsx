import { AlertTriangle, ShieldAlert, Users } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { StaffWhatsappLink } from "@/components/StaffWhatsappLink";
import { ExportFormatLinks } from "@/components/dashboard/ExportFormatLinks";
import { LocalDate } from "@/components/ui/LocalDate";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { listSalonCustomersForDashboard } from "@/lib/salon-customer-sensitive";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { badgeToneClass } from "@/lib/order-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import { customerWhatsappText, whatsappHref } from "@/lib/whatsapp";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string; q?: string; status?: string }> };

function membershipStatusLabel(status: string | null | undefined) {
  if (status === "canceled") return "cancelled";
  return status ?? "scheduled";
}

export default async function ClientsPage({ searchParams }: Props) {
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
    ["owner", "manager", "frontdesk", "instructor"],
  );

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", activeStudioId)
    .eq("is_active", true)
    .order("name");

  const listResult = await listSalonCustomersForDashboard({
    userId: user.id,
    email: user.email ?? null,
    studioId: activeStudioId,
    locationId: selectedLocationId ?? null,
  });
  if (!listResult.ok) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const customers = listResult.customers;
  const userIds = [...new Set(customers.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];

  const [{ data: users }, { data: profiles }] = await Promise.all([
    userIds.length > 0
      ? admin.from("users").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [] as const }),
    userIds.length > 0
      ? admin.from("user_profiles").select("id, full_name, phone").in("id", userIds)
      : Promise.resolve({ data: [] as const }),
  ]);

  const userMap = new Map((users ?? []).map((row) => [row.id, row]));
  const profileMap = new Map((profiles ?? []).map((row) => [row.id, row]));

  const { data: packsRaw } = userIds.length > 0
    ? await admin
        .from("client_packages")
        .select(
          `
          id,
          client_id,
          credits_left,
          expiry_date,
          packages!inner(studio_id, location_id)
        `,
        )
        .in("client_id", userIds)
        .in("packages.studio_id", [activeStudioId])
    : { data: [] as const };

  const activeCreditsByUser = new Map<string, number>();
  for (const row of packsRaw ?? []) {
    const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
    if (selectedLocationId && pkg?.location_id && pkg.location_id !== selectedLocationId) continue;
    const current = activeCreditsByUser.get(row.client_id) ?? 0;
    if (Number(row.credits_left ?? 0) > 0) {
      activeCreditsByUser.set(row.client_id, current + Number(row.credits_left ?? 0));
    }
  }

  const { data: subscriptionsRaw } = userIds.length > 0
    ? await admin
        .from("customer_subscriptions")
        .select("id, client_id, status, membership_name_snapshot, billing_interval_snapshot, created_at, current_period_end, cancel_at_period_end, canceled_at, membership_products!inner(studio_id, location_id)")
        .eq("studio_id", activeStudioId)
        .in("client_id", userIds)
        .order("created_at", { ascending: false })
    : { data: [] as const };

  const subscriptionByUser = new Map<string, {
    status: string;
    interval: "monthly" | "yearly";
    startedAt: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    canceledAt: string | null;
  }>();

  for (const row of subscriptionsRaw ?? []) {
    const membership = Array.isArray(row.membership_products) ? row.membership_products[0] : row.membership_products;
    if (selectedLocationId && membership?.location_id && membership.location_id !== selectedLocationId) continue;
    if (!subscriptionByUser.has(row.client_id)) {
      subscriptionByUser.set(row.client_id, {
        status: row.status ?? "scheduled",
        interval: row.billing_interval_snapshot === "yearly" ? "yearly" : "monthly",
        startedAt: row.created_at ?? null,
        current_period_end: row.current_period_end ?? null,
        cancel_at_period_end: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at ?? null,
      });
    }
  }

  const { data: bookingsRaw } = userIds.length > 0
    ? await admin
        .from("bookings")
        .select("id, client_id, status, created_at, class_sessions(start_time, classes(title, studio_id), location_id)")
        .in("client_id", userIds)
        .order("created_at", { ascending: false })
        .limit(1500)
    : { data: [] as const };

  const lastActivityByUser = new Map<string, { startTime: string | null; classTitle: string }>();
  for (const row of bookingsRaw ?? []) {
    const session = (Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions) as {
      start_time?: string | null;
      location_id?: string | null;
      classes?: { title?: string | null; studio_id?: string | null } | { title?: string | null; studio_id?: string | null }[] | null;
    } | null;
    const sessionClass = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
    if (sessionClass?.studio_id !== activeStudioId) continue;
    if (selectedLocationId && session?.location_id !== selectedLocationId) continue;
    if (!lastActivityByUser.has(row.client_id)) {
      lastActivityByUser.set(row.client_id, {
        startTime: session?.start_time ?? null,
        classTitle: sessionClass?.title ?? "Class",
      });
    }
  }

  const keyword = (sp.q ?? "").trim().toLowerCase();
  const statusFilter = (sp.status ?? "").trim().toLowerCase();

  const rows = customers
    .map((customer) => {
      const profile = customer.user_id ? profileMap.get(customer.user_id) : null;
      const account = customer.user_id ? userMap.get(customer.user_id) : null;
      const subscription = customer.user_id ? subscriptionByUser.get(customer.user_id) ?? null : null;
      const credits = customer.user_id ? activeCreditsByUser.get(customer.user_id) ?? 0 : 0;
      const lastActivity = customer.user_id ? lastActivityByUser.get(customer.user_id) ?? null : null;

      const searchable = `${customer.full_name} ${customer.email ?? ""} ${customer.phone ?? ""} ${profile?.full_name ?? ""} ${profile?.phone ?? ""} ${account?.email ?? ""}`.toLowerCase();
      if (keyword && !searchable.includes(keyword)) return null;
      if (statusFilter && customer.status !== statusFilter) return null;

      return {
        customer,
        profile,
        account,
        subscription,
        credits,
        lastActivity,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => left.customer.full_name.localeCompare(right.customer.full_name));

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
        <h1 className={ui.h1}>Customers</h1>
        <p className={`mt-1 ${ui.muted}`}>Studio-scoped customer roster (`salon_customers`) with safe health alert flags.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DashboardAppLink
            href={`/dashboard/clients/follow-ups?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnSecondarySm}
          >
            Follow-up queue
          </DashboardAppLink>
          <ExportFormatLinks
            baseHref={`/api/reports/business/export?${new URLSearchParams({
              kind: "customers",
              studio_id: activeStudioId,
              ...(selectedLocationId ? { location_id: selectedLocationId } : {}),
              ...(sp.q ? { q: sp.q } : {}),
              ...(statusFilter ? { status: statusFilter } : {}),
            }).toString()}`}
          />
        </div>
      </div>

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-4`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <label className="sm:col-span-2">
          <span className={ui.label}>Search customer (name / phone / email)</span>
          <input name="q" className={`${ui.input} mt-1`} defaultValue={sp.q ?? ""} placeholder="e.g. Chloe / +65 / customer@email.com" />
        </label>
        <label>
          <span className={ui.label}>Customer status</span>
          <select name="status" className={`${ui.select} mt-1`} defaultValue={statusFilter}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className={ui.btnPrimarySm} type="submit">Search</button>
          <DashboardAppLink
            href={`/dashboard/clients?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnGhost}
          >
            Clear
          </DashboardAppLink>
        </div>
      </form>

      <ul className="mt-1 flex flex-col gap-3 text-sm">
        {rows.map(({ customer, profile, account, subscription, credits, lastActivity }) => (
          <li key={customer.id}>
            <div className={ui.card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{customer.full_name}</p>
                  <p className={`truncate text-xs ${ui.muted}`}>{customer.email ?? account?.email ?? customer.id}</p>
                  <p className={`truncate text-xs ${ui.muted}`}>{customer.phone ?? profile?.phone ?? "No phone"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StaffWhatsappLink
                    href={whatsappHref(customer.phone ?? profile?.phone, customerWhatsappText(customer.full_name))}
                  />
                  <DashboardAppLink
                    href={`/dashboard/clients/${customer.id}?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                    className={ui.btnSecondarySm}
                  >
                    Open customer
                  </DashboardAppLink>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {customer.safety.hasHealthAlert ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <AlertTriangle size={12} />
                    Safety alert on file
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                    <ShieldAlert size={12} />
                    No active safety alert
                  </span>
                )}

                {subscription ? (() => {
                  const displayStatus = getMembershipDisplayStatus(subscription);
                  return (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(
                      displayStatus === "active"
                        ? "teal"
                        : displayStatus === "retrying"
                          ? "amber"
                          : displayStatus === "ending"
                            ? "blue"
                            : "stone",
                    )}`}>
                      {subscription.interval === "yearly" ? "Yearly" : "Monthly"} · {membershipStatusLabel(displayStatus)}
                    </span>
                  );
                })() : (
                  <span className={`text-xs ${ui.muted}`}>No membership subscription</span>
                )}
              </div>

              <div className="mt-3 border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
                <div className="grid gap-2 sm:grid-cols-2">
                  <p className={ui.muted}>Class passes: <span className="font-semibold text-stone-800 dark:text-stone-200">{credits}</span></p>
                  <p className={ui.muted}>
                    Last activity:{" "}
                    <span className="font-semibold text-stone-800 dark:text-stone-200">
                      {lastActivity?.startTime ? <>{lastActivity.classTitle} · <LocalTime iso={lastActivity.startTime} /></> : "—"}
                    </span>
                  </p>
                </div>
                {subscription?.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription) ? (
                  <p className={`mt-2 ${ui.muted}`}>Active until <LocalDate iso={subscription.current_period_end} /></p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!rows.length ? (
        <div className={`mt-4 ${ui.emptyState}`}>
          <div className={ui.emptyStateIcon}><Users size={18} /></div>
          <p className={`text-sm ${ui.muted}`}>No customers found in this scope.</p>
        </div>
      ) : null}
    </div>
  );
}
