import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { normalizeStudioSlug } from "@/lib/slug";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function MyClassPassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const c = await cookies();
  const activeStudioSlug = normalizeStudioSlug(c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
  const packagesHref = activeStudioSlug ? `/${activeStudioSlug}#packages` : "/booking";

  const { data: rows } = await supabase
    .from("client_packages")
    .select("id, credits_left, expiry_date, created_at, packages(name, credits, studio_id)")
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  const { data: usageRows } = await supabase
    .from("bookings")
    .select(`
      id,
      status,
      credits_consumed,
      credit_consumed_at,
      created_at,
      class_sessions (
        start_time,
        classes ( title )
      )
    `)
    .eq("client_id", user.id)
    .gt("credits_consumed", 0)
    .order("credit_consumed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className={ui.h1}>My class passes</h1>
            <p className={`mt-1 ${ui.muted}`}>Your active class pass balances and expiry dates.</p>
          </div>
          <a href={packagesHref} className={`${ui.btnSecondary} shrink-0`}>
            Buy passes
          </a>
        </div>

        {!rows?.length ? (
          <div className={`mt-6 ${ui.emptyState}`}>
            <p className={ui.muted}>No class passes yet.</p>
            <a href={packagesHref} className={`mt-1 text-sm ${ui.link}`}>
              Buy class passes →
            </a>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {rows.map((r) => {
              const pkg = Array.isArray(r.packages) ? r.packages[0] : r.packages;
              const expiry = r.expiry_date
                ? new Date(r.expiry_date).toLocaleDateString("en-SG", { dateStyle: "medium" })
                : "No expiry";
              return (
                <li key={r.id} className={ui.card}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{pkg?.name ?? "Class pass package"}</p>
                    <span className={ui.badgeNeutral}>Left: {Math.max(0, Number(r.credits_left ?? 0))}</span>
                  </div>
                  <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm ${ui.muted}`}>
                    <span>Pack size: {Math.max(0, Number(pkg?.credits ?? 0))}</span>
                    <span>Expiry: {expiry}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-8">
          <h2 className={ui.h2}>Pass usage history</h2>
          <p className={`mt-1 text-sm ${ui.muted}`}>Sessions booked using class passes.</p>
          {!usageRows?.length ? (
            <div className={`mt-4 ${ui.emptyState}`}>
              <p className={ui.muted}>No class pass usage yet.</p>
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {usageRows.map((u) => {
                const session = Array.isArray(u.class_sessions) ? u.class_sessions[0] : u.class_sessions;
                const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
                const statusBadge = getUnifiedStatusBadges({ booking_status: u.status }).booking;
                const when = session?.start_time
                  ? new Date(session.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })
                  : "-";
                const usedAt = u.credit_consumed_at
                  ? new Date(u.credit_consumed_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })
                  : null;
                return (
                  <li key={u.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{cls?.title ?? "Class session"}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(statusBadge.tone)}`}>
                        {statusBadge.text}
                      </span>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                      <span>{when}</span>
                      <span>Used: {Math.max(0, Number(u.credits_consumed ?? 0))} pass{Number(u.credits_consumed ?? 0) !== 1 ? "es" : ""}</span>
                      {usedAt ? <span>Recorded: {usedAt}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
