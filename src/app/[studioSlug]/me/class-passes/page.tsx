import Link from "next/link";
import { redirect } from "next/navigation";
import { studioPackagePath, studioPackagesPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ studioSlug: string }> };

type PassRow = {
  id: string;
  credits_left: number | null;
  expiry_date: string | null;
  created_at: string | null;
  package_name_snapshot?: string | null;
  package_credits_snapshot?: number | null;
};

function passCard(r: PassRow, now: number) {
  const expiryMs = r.expiry_date ? new Date(r.expiry_date).getTime() : null;
  const isExpired = expiryMs != null && expiryMs <= now;
  const isUsedUp = Number(r.credits_left ?? 0) <= 0;
  const isDepleted = isExpired || isUsedUp;
  const daysLeft =
    expiryMs != null && !isExpired ? Math.ceil((expiryMs - now) / (1000 * 60 * 60 * 24)) : null;
  const expiryLabel = r.expiry_date
    ? new Date(r.expiry_date).toLocaleDateString("en-SG", {
        dateStyle: "medium",
        timeZone: "Asia/Singapore",
      })
    : "No expiry";
  const packageName =
    (r as { package_name_snapshot?: string | null }).package_name_snapshot?.trim() || "Class pass package";
  const packSize = Math.max(0, Number((r as { package_credits_snapshot?: number | null }).package_credits_snapshot ?? 0));
  const creditsLeft = Math.max(0, Number(r.credits_left ?? 0));
  return (
    <li key={r.id} className={`${ui.card} ${isDepleted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          className={`font-semibold ${isDepleted ? "text-stone-500 dark:text-stone-400" : "text-stone-900 dark:text-stone-100"}`}
        >
          {packageName}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {isExpired ? (
            <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
              Expired
            </span>
          ) : isUsedUp ? (
            <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-500 dark:bg-stone-700 dark:text-stone-400">
              Used up
            </span>
          ) : daysLeft != null && daysLeft <= 7 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              Expires in {daysLeft}d
            </span>
          ) : null}
          <span className={isDepleted ? ui.badgeNeutral : ui.badge}>
            {creditsLeft} pass{creditsLeft !== 1 ? "es" : ""} left
          </span>
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm ${ui.muted}`}>
        <span>Pack size: {packSize}</span>
        <span>Expiry: {expiryLabel}</span>
      </div>
    </li>
  );
}

export default async function MyClassPassesPage({ params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);
  if (!studioSlug) redirect("/");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/class-passes`)}`);

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio?.id) redirect("/");

  const { data: rows } = await supabase
    .from("client_packages")
    .select("id, credits_left, expiry_date, created_at, package_name_snapshot, package_credits_snapshot, packages!inner(studio_id)")
    .eq("client_id", user.id)
    .eq("packages.studio_id", studio.id)
    .order("created_at", { ascending: false });

  const { data: catalogPackages } = await admin
    .from("packages")
    .select("id, name, price, credits, expiry_days, share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("price", { ascending: true });
  const packagesList = catalogPackages ?? [];

  const { data: usageRows } = await supabase
    .from("bookings")
    .select(`
      id,
      status,
      credits_consumed,
      credit_consumed_at,
      created_at,
      class_sessions!inner (
        start_time,
        classes!inner ( title, studio_id )
      )
    `)
    .eq("client_id", user.id)
    .eq("class_sessions.classes.studio_id", studio.id)
    .gt("credits_consumed", 0)
    .order("credit_consumed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  const now = Date.now();
  const allPasses = (rows ?? []) as PassRow[];
  const activePasses = allPasses.filter((r) => {
    const expiryMs = r.expiry_date ? new Date(r.expiry_date).getTime() : null;
    const isExpired = expiryMs != null && expiryMs <= now;
    const isUsedUp = Number(r.credits_left ?? 0) <= 0;
    return !isExpired && !isUsedUp;
  });
  const pastPasses = allPasses.filter((r) => {
    const expiryMs = r.expiry_date ? new Date(r.expiry_date).getTime() : null;
    const isExpired = expiryMs != null && expiryMs <= now;
    const isUsedUp = Number(r.credits_left ?? 0) <= 0;
    return isExpired || isUsedUp;
  });

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className={ui.h1}>My class passes</h1>
          <p className={`mt-1 ${ui.muted}`}>Your class pass balances and usage for this studio.</p>
        </div>

        {activePasses.length > 0 ? (
          <section className="space-y-3">
            <h2 className={ui.h2}>Active</h2>
            <ul className="flex flex-col gap-3">{activePasses.map((r) => passCard(r, now))}</ul>
          </section>
        ) : null}

        {!activePasses.length && !pastPasses.length ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>
              {packagesList.length > 0 ? (
                <>
                  You don&apos;t have any class passes yet.{" "}
                  <span className="text-stone-700 dark:text-stone-300">Choose a package below to purchase</span>
                  — checkout is on the package page.
                </>
              ) : (
                <>
                  You don&apos;t have any class passes for this studio yet. This studio hasn&apos;t listed any
                  packages — check back later.
                </>
              )}
            </p>
          </div>
        ) : null}

        {pastPasses.length > 0 ? (
          <section className="space-y-3 opacity-60">
            <h2 className={`${ui.h2} text-stone-400 dark:text-stone-500`}>Past passes</h2>
            <ul className="flex flex-col gap-2">{pastPasses.map((r) => passCard(r, now))}</ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className={ui.h2}>{activePasses.length ? "Other packages" : "Packages"}</h2>
          <p className={`text-sm ${ui.muted}`}>Class pass packs offered by this studio. Purchase opens on the package page.</p>
          {packagesList.length === 0 ? (
            <div className={ui.emptyState}>
              <p className={`text-sm ${ui.muted}`}>No packages listed for this studio yet.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {packagesList.map((pkg) => {
                const ccy = String((pkg as { currency?: string | null }).currency ?? "SGD").toUpperCase();
                const href = pkg.share_slug
                  ? studioPackagePath(studioSlug, pkg.share_slug)
                  : studioPackagesPath(studioSlug);
                const expiryLabel = pkg.expiry_days
                  ? `Expires in ${pkg.expiry_days} days`
                  : "No expiry";
                return (
                  <li key={pkg.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={href}
                          className="font-semibold text-stone-900 transition hover:text-teal-700 dark:text-stone-100 dark:hover:text-teal-400"
                        >
                          {pkg.name}
                        </Link>
                        <p className={`mt-1 text-sm ${ui.muted}`}>
                          {pkg.credits} class pass{Number(pkg.credits) !== 1 ? "es" : ""} · {expiryLabel}
                        </p>
                        {pkg.price != null ? (
                          <p className="mt-1 text-sm font-medium tabular-nums text-stone-800 dark:text-stone-200">
                            {ccy} {Number(pkg.price).toFixed(2)}
                          </p>
                        ) : null}
                      </div>
                      <Link href={href} className={`${ui.btnPrimary} shrink-0 inline-flex justify-center text-sm`}>
                        Buy now
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className={ui.h2}>Pass usage history</h2>
          <p className={`text-sm ${ui.muted}`}>Sessions booked using class passes.</p>
          {!usageRows?.length ? (
            <div className={ui.emptyState}>
              <p className={ui.muted}>No class pass usage yet.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {usageRows.map((u) => {
                const session = Array.isArray(u.class_sessions) ? u.class_sessions[0] : u.class_sessions;
                const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
                const statusBadge = getUnifiedStatusBadges({ booking_status: u.status }).booking;
                const when = session?.start_time
                  ? new Date(session.start_time).toLocaleString("en-SG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Singapore",
                    })
                  : "-";
                const usedAt = u.credit_consumed_at
                  ? new Date(u.credit_consumed_at).toLocaleString("en-SG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Singapore",
                    })
                  : null;
                return (
                  <li key={u.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{cls?.title ?? "Class session"}</p>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(statusBadge.tone)}`}
                      >
                        {statusBadge.text}
                      </span>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                      <span>{when}</span>
                      <span>
                        Used: {Math.max(0, Number(u.credits_consumed ?? 0))} pass
                        {Number(u.credits_consumed ?? 0) !== 1 ? "es" : ""}
                      </span>
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
