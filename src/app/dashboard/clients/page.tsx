import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScope } from "@/lib/dashboard";
import {
  filterPacksForDashboard,
  type MemberPackageForCredits,
} from "@/lib/memberCredits";
import { bestRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Users } from "lucide-react";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string; q?: string }> };

export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Create your first studio in Overview.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const keyword = (sp.q ?? "").trim().toLowerCase();

  let paymentsQuery = supabase
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
      ? supabase.from("users").select("id, email").in("id", allClientIds)
      : Promise.resolve({ data: [] as const }),
    allClientIds.length > 0
      ? admin.from("user_profiles").select("id, full_name, phone").in("id", allClientIds)
      : Promise.resolve({ data: [] as const }),
  ]);
  const userMap = new Map((users ?? []).map((u) => [u.id, u]));
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const { data: packsRaw } = await supabase
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

  let bookingsQuery = supabase
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
      const searchable = `${name ?? ""} ${phone ?? ""} ${email}`.toLowerCase();
      if (keyword && !searchable.includes(keyword)) return null;
      return {
        clientId,
        name,
        email,
        phone,
        activeCredits,
        lastActivity: history[0] ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>User records</h1>
        <p className={`mt-1 ${ui.muted}`}>Registered users with quick contact and class pass status.</p>
      </div>

      <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-3`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <label className="sm:col-span-2">
          <span className={ui.label}>Search user (name / phone / email)</span>
          <input
            name="q"
            className={`${ui.input} mt-1`}
            placeholder="e.g. Chloe / +65 / user@email.com"
            defaultValue={sp.q ?? ""}
          />
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
          {memberRows.map(({ clientId, name, email, phone, activeCredits, lastActivity }) => (
            <li key={clientId}>
              <div className={`${ui.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {name ?? "Unnamed member"}
                    </p>
                    <p className={`truncate text-xs ${ui.muted}`}>{email || clientId}</p>
                    <p className={`truncate text-xs ${ui.muted}`}>{phone?.trim() ? phone : "No phone"}</p>
                  </div>
                  <DashboardAppLink
                    href={`/dashboard/clients/${clientId}?studio_id=${selectedStudioId ?? studioIds[0]}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                    className={ui.btnSecondarySm}
                  >
                    Open user
                  </DashboardAppLink>
                </div>
                <div className="mt-3 border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className={ui.muted}>
                      Class passes: <span className="font-semibold text-stone-800 dark:text-stone-200">{activeCredits}</span>
                    </p>
                    <p className={ui.muted}>
                      Last activity:{" "}
                      <span className="font-semibold text-stone-800 dark:text-stone-200">
                        {lastActivity?.startTime
                          ? `${lastActivity.classTitle} · ${new Date(lastActivity.startTime).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}`
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
            <p className={`text-sm ${ui.muted}`}>No users found in this scope.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
