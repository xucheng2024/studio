import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScope } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import {
  filterPacksForDashboard,
  nearestExpiryDate,
  type MemberPackageForCredits,
} from "@/lib/memberCredits";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Package, CalendarX } from "lucide-react";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
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

  let classQuery = supabase
    .from("classes")
    .select("id, location_id")
    .in("studio_id", studioIds);
  if (selectedLocationId) classQuery = classQuery.eq("location_id", selectedLocationId);
  const { data: classRows } = await classQuery;
  const classIds = (classRows ?? []).map((c) => c.id);

  let sessionIds: string[] = [];
  if (classIds.length) {
    const { data: sess } = await supabase
      .from("class_sessions")
      .select("id")
      .in("class_id", classIds)
      .limit(400);
    sessionIds = (sess ?? []).map((s) => s.id);
  }

  const { data: bookings } =
    sessionIds.length > 0
      ? await supabase
          .from("bookings")
          .select(
            `
          id,
          client_id,
          status,
          created_at,
          guest_name,
          guest_email,
          users ( email ),
          class_sessions ( start_time, classes ( title ) )
        `,
          )
          .in("session_id", sessionIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : { data: [] as const };

  const { data: packsRaw } = await supabase
    .from("client_packages")
    .select(
      `
      id,
      client_id,
      credits_left,
      expiry_date,
      packages!inner ( name, studio_id, location_id )
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
    packages?: { name?: string; studio_id?: string; location_id?: string | null } | null;
  }[]).map((p) => {
    const pkg = Array.isArray(p.packages) ? p.packages[0] : p.packages;
    return {
      id: p.id,
      client_id: p.client_id,
      name: pkg?.name ?? "Package",
      credits_left: p.credits_left,
      expiry_date: p.expiry_date,
      studio_id: pkg?.studio_id ?? "",
      location_id: pkg?.location_id ?? null,
    };
  });

  const packs = filterPacksForDashboard(packRows, studioIds, selectedLocationId ?? null);

  const byClient = new Map<string, MemberPackageForCredits[]>();
  for (const row of packs) {
    const cid = row.client_id;
    if (!cid) continue;
    const arr = byClient.get(cid) ?? [];
    arr.push(row);
    byClient.set(cid, arr);
  }

  const clientIdsForEmail = [...byClient.keys()];
  const { data: clientUsers } =
    clientIdsForEmail.length > 0
      ? await supabase.from("users").select("id, email").in("id", clientIdsForEmail)
      : { data: [] as const };
  const emailById = new Map((clientUsers ?? []).map((u) => [u.id, u.email ?? ""]));

  const memberSummaries = [...byClient.entries()]
    .map(([clientId, rows]) => {
      const total = rows.reduce((a, r) => a + r.credits_left, 0);
      const nearest = nearestExpiryDate(rows);
      return {
        clientId,
        email: emailById.get(clientId) ?? clientId,
        rows,
        total,
        nearestExpiryLabel: nearest ? new Date(nearest).toLocaleDateString() : "—",
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Member records</h1>
        <p className={`mt-1 ${ui.muted}`}>Active credit balances and booking history for your studio members.</p>
      </div>

      <div>
        <h2 className={ui.h2}>Active credits</h2>
        <p className={`mt-1 max-w-2xl text-sm ${ui.muted}`}>
          Same rules as member booking: studio scope, location-specific packages only when they match the
          selected location filter, credits left &gt; 0, not expired. Booking uses auto-apply credits (earliest
          expiry first).
        </p>
        <ul className="mt-4 flex flex-col gap-3 text-sm">
          {memberSummaries.map(({ clientId, email, rows, total, nearestExpiryLabel }) => (
            <li key={clientId}>
              <details className="chevron rounded-lg border border-stone-200 dark:border-stone-700">
                <summary className="cursor-pointer px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                    <span className="font-medium text-stone-900 dark:text-stone-100">{email}</span>
                    <span className={`text-xs ${ui.muted}`}>
                      Total credits: <span className="font-semibold text-stone-800 dark:text-stone-200">{total}</span>
                      {" · "}
                      Nearest expiry: {nearestExpiryLabel}
                    </span>
                  </div>
                </summary>
                <ul className="border-t border-stone-100 px-3 py-2 text-xs dark:border-stone-800">
                  <li className="pb-2">
                    <DashboardAppLink
                      href={`/dashboard/clients/${clientId}?studio_id=${selectedStudioId ?? studioIds[0]}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
                      className={ui.btnSecondarySm}
                    >
                      Open package ledger
                    </DashboardAppLink>
                  </li>
                  {rows.map((p) => (
                    <li key={p.id} className="py-1">
                      <span className="text-stone-800 dark:text-stone-200">{p.name}</span>
                      {" · "}
                      {p.credits_left} left
                      {" · "}
                      {p.expiry_date ? `exp ${new Date(p.expiry_date).toLocaleDateString()}` : "no expiry"}
                      {" · "}
                      {p.location_id ? "One location (see package setup)" : "All locations"}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        {!memberSummaries.length ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <div className={ui.emptyStateIcon}><Package size={18} /></div>
            <p className={`text-sm ${ui.muted}`}>No active package credits yet.</p>
          </div>
        ) : null}
      </div>

      <div>
        <h2 className={ui.h2}>Booking and attendance history</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {(bookings ?? []).map((b) => {
            const u = b.users as { email?: string | null } | null;
            const cs = b.class_sessions as {
              start_time?: string;
              classes?: { title?: string } | null;
            } | null;
            const memberLabel =
              b.client_id != null
                ? (u?.email ?? b.client_id)
                : `${b.guest_name ?? "Guest"}${b.guest_email ? ` · ${b.guest_email}` : ""}`;
            const badge = getUnifiedStatusBadges({ booking_status: b.status }).booking;
            return (
              <li
                key={b.id}
                className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40"
              >
                {/* Row 1: member + status badge */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                    {memberLabel}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(badge.tone)}`}>
                    {badge.text}
                  </span>
                </div>
                {/* Row 2: class + time */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  <span>{cs?.classes?.title ?? "Class"}</span>
                  {cs?.start_time ? <span>{new Date(cs.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {!bookings?.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <div className={ui.emptyStateIcon}><CalendarX size={18} /></div>
            <p className={`text-sm ${ui.muted}`}>No bookings yet.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
