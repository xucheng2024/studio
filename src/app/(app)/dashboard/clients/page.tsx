import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { LocalDate } from "@/components/ui/LocalDate";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  filterPacksForDashboard,
  type MemberPackageForCredits,
} from "@/lib/memberCredits";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { badgeToneClass } from "@/lib/order-status";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Users } from "lucide-react";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string; q?: string; membership_status?: string }> };

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
  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner", "manager", "frontdesk"]);
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

  const keyword = (sp.q ?? "").trim().toLowerCase();
  const membershipStatusFilter = (sp.membership_status ?? "").trim().toLowerCase();

  let paymentsQuery = admin
    .from("payments")
    .select("client_id, amount, status, created_at, location_id")
    .in("studio_id", studioIds)
    .not("client_id", "is", null)
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(2000);
  if (selectedLocationId) paymentsQuery = paymentsQuery.eq("location_id", selectedLocationId);
  const { data: payments } = await paymentsQuery;

  const paidByClient = new Map<string, { paidCount: number; netAmount: number; lastPaidAt: string | null }>();
  for (const p of payments ?? []) {
    const clientId = p.client_id ?? null;
    if (!clientId) continue;
    const row = paidByClient.get(clientId) ?? { paidCount: 0, netAmount: 0, lastPaidAt: null };
    const amount = Number(p.amount ?? 0);
    if (p.status === "paid") {
      row.paidCount += 1;
      row.netAmount += amount;
      if (!row.lastPaidAt || new Date(p.created_at).getTime() > new Date(row.lastPaidAt).getTime()) {
        row.lastPaidAt = p.created_at;
      }
    } else if (p.status === "refunded") {
      row.netAmount -= amount;
    }
    paidByClient.set(clientId, row);
  }

  const { data: memberRowsRaw } = await admin
    .from("member_studio_memberships")
    .select("user_id")
    .in("studio_id", studioIds)
    .eq("status", "active")
    .limit(5000);

  const memberClientIds = (memberRowsRaw ?? [])
    .map((m) => (m as { user_id?: string | null }).user_id)
    .filter((id): id is string => Boolean(id));
  const allClientIds = [...new Set(memberClientIds)];

  const [{ data: users }, { data: profiles }] = await Promise.all([
    allClientIds.length > 0
      ? admin.from("users").select("id, email").in("id", allClientIds)
      : Promise.resolve({ data: [] as const }),
    allClientIds.length > 0
      ? admin.from("user_profiles").select("id, full_name, phone").in("id", allClientIds)
      : Promise.resolve({ data: [] as const }),
  ]);
  const userMap = new Map((users ?? []).map((u) => [u.id, u]));
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const { data: packsRaw } = await admin
    .from("client_packages")
    .select(
      `
      id,
      client_id,
      credits_left,
      expiry_date,
      package_name_snapshot,
      packages!inner ( studio_id, location_id )
    `,
    )
    .in("packages.studio_id", studioIds)
    .gt("credits_left", 0)
    .or(`expiry_date.is.null,expiry_date.gt.${new Date().toISOString()}`)
    .limit(500);

  const packRows: MemberPackageForCredits[] = ((packsRaw ?? []) as {
    id: string;
    client_id: string;
    credits_left: number;
    expiry_date: string | null;
    package_name_snapshot?: string | null;
    packages?: { studio_id?: string; location_id?: string | null } | null;
  }[]).map((p) => {
    const pkg = Array.isArray(p.packages) ? p.packages[0] : p.packages;
    return {
      id: p.id,
      client_id: p.client_id,
      name: p.package_name_snapshot?.trim() || "Package",
      credits_left: p.credits_left,
      expiry_date: p.expiry_date,
      studio_id: pkg?.studio_id ?? "",
      location_id: pkg?.location_id ?? null,
    };
  });

  const packs = filterPacksForDashboard(packRows, studioIds, selectedLocationId ?? null);

  const activePacksByClient = new Map<string, MemberPackageForCredits[]>();
  for (const row of packs) {
    const cid = row.client_id;
    if (!cid) continue;
    const arr = activePacksByClient.get(cid) ?? [];
    arr.push(row);
    activePacksByClient.set(cid, arr);
  }

  const { data: subscriptionsRaw } = await admin
    .from("customer_subscriptions")
    .select("id, client_id, status, membership_name_snapshot, billing_interval_snapshot, created_at, current_period_end, cancel_at_period_end, canceled_at, membership_products!inner(studio_id, location_id)")
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false })
    .limit(2000);

  const subscriptions = (selectedLocationId
    ? (subscriptionsRaw ?? []).filter((row) => {
        const membership = Array.isArray(row.membership_products) ? row.membership_products[0] : row.membership_products;
        return !membership?.location_id || membership.location_id === selectedLocationId;
      })
    : (subscriptionsRaw ?? [])) as Array<{
      id: string;
      client_id: string;
      status: string | null;
      membership_name_snapshot?: string | null;
      billing_interval_snapshot?: string | null;
      created_at: string | null;
      current_period_end?: string | null;
      cancel_at_period_end?: boolean | null;
      canceled_at?: string | null;
    }>;

  const subscriptionByClient = new Map<
    string,
    {
      name: string;
      interval: "monthly" | "yearly";
      status: string;
      startedAt: string | null;
      current_period_end?: string | null;
      cancel_at_period_end?: boolean | null;
      canceledAt: string | null;
    }
  >();
  const subscriptionRank = (status: string | null | undefined) => {
    switch (status) {
      case "active":
        return 5;
      case "retrying":
        return 4;
      case "scheduled":
        return 3;
      case "paused":
        return 2;
      case "inactive":
        return 1;
      case "canceled":
        return 0;
      default:
        return -1;
    }
  };
  for (const row of subscriptions) {
    const existing = subscriptionByClient.get(row.client_id);
    const candidate = {
      name: row.membership_name_snapshot?.trim() || "Membership",
      interval: row.billing_interval_snapshot === "yearly" ? "yearly" : "monthly",
      status: row.status ?? "scheduled",
      startedAt: row.created_at ?? null,
      current_period_end: row.current_period_end ?? null,
      cancel_at_period_end: row.cancel_at_period_end ?? false,
      canceledAt: row.canceled_at ?? null,
    } as const;
    if (!existing) {
      subscriptionByClient.set(row.client_id, candidate);
      continue;
    }
    const existingRank = subscriptionRank(existing.status);
    const nextRank = subscriptionRank(candidate.status);
    if (nextRank > existingRank) {
      subscriptionByClient.set(row.client_id, candidate);
      continue;
    }
    if (nextRank === existingRank) {
      const existingTime = existing.startedAt ? new Date(existing.startedAt).getTime() : 0;
      const nextTime = candidate.startedAt ? new Date(candidate.startedAt).getTime() : 0;
      if (nextTime > existingTime) {
        subscriptionByClient.set(row.client_id, candidate);
      }
    }
  }

  let bookingsQuery = admin
    .from("bookings")
    .select("id, client_id, status, created_at, session_id, class_sessions(start_time, classes(title, studio_id), location_id)")
    .in("client_id", allClientIds)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (selectedLocationId) {
    bookingsQuery = bookingsQuery.eq("location_id", selectedLocationId);
  }
  const { data: bookingsRaw } = allClientIds.length > 0 ? await bookingsQuery : { data: [] as const };

  const bookingByClient = new Map<
    string,
    Array<{ id: string; status: string | null; startTime: string | null; classTitle: string }>
  >();
  for (const b of bookingsRaw ?? []) {
    const clientId = b.client_id ?? null;
    if (!clientId) continue;
    const cs = b.class_sessions as
      | {
          start_time?: string | null;
          location_id?: string | null;
          classes?: { title?: string | null; studio_id?: string | null } | null;
        }
      | null;
    const studioId = cs?.classes?.studio_id ?? null;
    if (!studioId || !studioIds.includes(studioId)) continue;
    const arr = bookingByClient.get(clientId) ?? [];
    arr.push({
      id: b.id,
      status: b.status ?? null,
      startTime: cs?.start_time ?? null,
      classTitle: cs?.classes?.title ?? "Class",
    });
    bookingByClient.set(clientId, arr);
  }

  const memberRows = allClientIds
    .map((clientId) => {
      const userRow = userMap.get(clientId);
      const profile = profileMap.get(clientId);
      const activeRows = activePacksByClient.get(clientId) ?? [];
      const activeCredits = activeRows.reduce((a, r) => a + r.credits_left, 0);
      const history = bookingByClient.get(clientId) ?? [];
      const name = (profile as { full_name?: string | null } | undefined)?.full_name ?? null;
      const phone = (profile as { phone?: string | null } | undefined)?.phone ?? null;
      const email = userRow?.email ?? "";
      const subscription = subscriptionByClient.get(clientId) ?? null;
      const searchable = `${name ?? ""} ${phone ?? ""} ${email} ${subscription?.name ?? ""} ${subscription?.interval ?? ""}`.toLowerCase();
      if (keyword && !searchable.includes(keyword)) return null;
      const displayStatus = subscription ? getMembershipDisplayStatus(subscription) : null;
      if (membershipStatusFilter === "none" && subscription && !isMembershipEnded(subscription)) return null;
      if (membershipStatusFilter && membershipStatusFilter !== "none" && displayStatus !== membershipStatusFilter) return null;
      return {
        clientId,
        name,
        email,
        phone,
        activeCredits,
        subscription,
        lastActivity: history[0] ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.email.localeCompare(b.email));

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
        <p className={`mt-1 ${ui.muted}`}>Registered customers with quick contact, membership, and class pass status.</p>
      </div>

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-4`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <label className="sm:col-span-2">
          <span className={ui.label}>Search customer (name / phone / email)</span>
          <input
            name="q"
            className={`${ui.input} mt-1`}
            placeholder="e.g. Chloe / +65 / customer@email.com"
            defaultValue={sp.q ?? ""}
          />
        </label>
        <label>
          <span className={ui.label}>Membership status</span>
          <select name="membership_status" className={`${ui.select} mt-1`} defaultValue={membershipStatusFilter}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="retrying">Retrying</option>
            <option value="scheduled">Scheduled</option>
            <option value="paused">Paused</option>
            <option value="inactive">Inactive</option>
            <option value="ending">Ending this period</option>
            <option value="canceled">Cancelled</option>
            <option value="none">No membership</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className={ui.btnPrimarySm} type="submit">Search</button>
          <DashboardAppLink
            href={`/dashboard/clients?studio_id=${selectedStudioId ?? studioIds[0]}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnGhost}
          >
            Clear
          </DashboardAppLink>
        </div>
      </form>

      <div>
        <ul className="mt-1 flex flex-col gap-3 text-sm">
          {memberRows.map(({ clientId, name, email, phone, activeCredits, subscription, lastActivity }) => (
            <li key={clientId}>
              <div className={`${ui.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {name ?? "Unnamed customer"}
                    </p>
                    <p className={`truncate text-xs ${ui.muted}`}>{email || clientId}</p>
                    <p className={`truncate text-xs ${ui.muted}`}>{phone?.trim() ? phone : "No phone"}</p>
                  </div>
                  <DashboardAppLink
                    href={`/dashboard/clients/${clientId}?studio_id=${selectedStudioId ?? studioIds[0]}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                    className={ui.btnSecondarySm}
                  >
                    Open customer
                  </DashboardAppLink>
                </div>
                {subscription ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(() => {
                      const displayStatus = getMembershipDisplayStatus(subscription);
                      const label = membershipStatusLabel(displayStatus);
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
                      {displayStatus === "active"
                        ? `${subscription.interval === "yearly" ? "Yearly" : "Monthly"} member`
                        : displayStatus === "ending"
                          ? `${subscription.interval === "yearly" ? "Yearly" : "Monthly"} · ending`
                          : `${subscription.interval === "yearly" ? "Yearly" : "Monthly"} · ${label}`}
                    </span>
                      );
                    })()}
                    <span className={`text-xs ${ui.muted}`}>
                      {subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription)
                        ? <>Active until <LocalDate iso={subscription.current_period_end} /></>
                        : subscription.status === "canceled"
                        ? <>Cancelled{subscription.canceledAt ? <> <LocalDate iso={subscription.canceledAt} /></> : null}</>
                        : subscription.startedAt
                          ? <>Started <LocalDate iso={subscription.startedAt} /> · Auto-renews until cancelled</>
                          : "Auto-renews until cancelled"}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3">
                    <span className={`text-xs ${ui.muted}`}>No membership subscription</span>
                  </div>
                )}
                <div className="mt-3 border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className={ui.muted}>
                      Class passes: <span className="font-semibold text-stone-800 dark:text-stone-200">{activeCredits}</span>
                    </p>
                    <p className={ui.muted}>
                      Last activity:{" "}
                      <span className="font-semibold text-stone-800 dark:text-stone-200">
                        {lastActivity?.startTime
                          ? <>{lastActivity.classTitle} · <LocalTime iso={lastActivity.startTime} /></>
                          : "—"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {!memberRows.length ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <div className={ui.emptyStateIcon}><Users size={18} /></div>
            <p className={`text-sm ${ui.muted}`}>No customers found in this scope.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
