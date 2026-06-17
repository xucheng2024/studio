import Link from "next/link";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { studioPackagePath, studioPackagesPath } from "@/lib/public-paths";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMeUser, requireStudioScope, getActiveMemberStudioSlugFromCookie, type MePageScope } from "./context";

type PassRow = {
  id: string;
  credits_left: number | null;
  expiry_date: string | null;
  created_at: string | null;
  package_name_snapshot?: string | null;
  package_credits_snapshot?: number | null;
};

function passCard(row: PassRow, now: number) {
  const expiryMs = row.expiry_date ? new Date(row.expiry_date).getTime() : null;
  const isExpired = expiryMs != null && expiryMs <= now;
  const isUsedUp = Number(row.credits_left ?? 0) <= 0;
  const isDepleted = isExpired || isUsedUp;
  const daysLeft = expiryMs != null && !isExpired ? Math.ceil((expiryMs - now) / (1000 * 60 * 60 * 24)) : null;
  const expiryLabel = row.expiry_date
    ? new Date(row.expiry_date).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" })
    : "No expiry";
  const packageName = row.package_name_snapshot?.trim() || "Class pass package";
  const packSize = Math.max(0, Number(row.package_credits_snapshot ?? 0));
  const creditsLeft = Math.max(0, Number(row.credits_left ?? 0));

  return (
    <li key={row.id} className={`${ui.card} ${isDepleted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`font-semibold ${isDepleted ? "text-stone-500 dark:text-stone-400" : "text-stone-900 dark:text-stone-100"}`}>
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

export async function renderClassPassesPage(scope?: MePageScope) {
  const studioSlug = scope?.studioSlug ?? null;
  const { supabase, user } = await requireMeUser(scope, "class-passes");
  const resolvedActiveStudioSlug = studioSlug ?? (await getActiveMemberStudioSlugFromCookie());
  const scopedStudio = studioSlug ? await requireStudioScope(studioSlug) : null;

  const admin = createAdminClient();
  const studioId = scopedStudio?.studio.id ?? null;

  const { data: rows } = studioId
    ? await supabase
        .from("client_packages")
        .select("id, credits_left, expiry_date, created_at, package_name_snapshot, package_credits_snapshot, packages!inner(studio_id)")
        .eq("client_id", user.id)
        .eq("packages.studio_id", studioId)
        .order("created_at", { ascending: false })
    : await supabase
        .from("client_packages")
        .select("id, credits_left, expiry_date, created_at, package_name_snapshot, package_credits_snapshot")
        .eq("client_id", user.id)
        .order("created_at", { ascending: false });

  let catalogPackages: Array<{
    id: string;
    name: string;
    price: number | null;
    credits: number | null;
    expiry_days: number | null;
    share_slug: string | null;
  }> | null = null;

  if (resolvedActiveStudioSlug) {
    const resolvedStudio = studioId
      ? { id: studioId }
      : (await supabase.from("studios").select("id").eq("public_slug", resolvedActiveStudioSlug).maybeSingle()).data;
    if (resolvedStudio?.id) {
      const { data: packages } = await admin
        .from("packages")
        .select("id, name, price, credits, expiry_days, share_slug")
        .eq("studio_id", resolvedStudio.id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("price", { ascending: true });
      catalogPackages = packages ?? [];
    }
  }

  const { data: usageRows } = studioId
    ? await supabase
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
        .eq("class_sessions.classes.studio_id", studioId)
        .gt("credits_consumed", 0)
        .order("credit_consumed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30)
    : await supabase
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

  const now = new Date().getTime();
  const allPasses = (rows ?? []) as PassRow[];
  const activePasses = allPasses.filter((row) => {
    const expiryMs = row.expiry_date ? new Date(row.expiry_date).getTime() : null;
    const isExpired = expiryMs != null && expiryMs <= now;
    const isUsedUp = Number(row.credits_left ?? 0) <= 0;
    return !isExpired && !isUsedUp;
  });
  const pastPasses = allPasses.filter((row) => {
    const expiryMs = row.expiry_date ? new Date(row.expiry_date).getTime() : null;
    const isExpired = expiryMs != null && expiryMs <= now;
    const isUsedUp = Number(row.credits_left ?? 0) <= 0;
    return isExpired || isUsedUp;
  });

  const packagesList = catalogPackages ?? [];
  const showCatalog = Boolean(resolvedActiveStudioSlug && catalogPackages !== null);

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className={ui.h1}>My class passes</h1>
          <p className={`mt-1 ${ui.muted}`}>
            {studioId ? "Your class pass balances and usage for this studio." : "Your class pass balances across studios."}
          </p>
        </div>

        {activePasses.length > 0 ? (
          <section className="space-y-3">
            <h2 className={ui.h2}>Active</h2>
            <ul className="flex flex-col gap-3">{activePasses.map((row) => passCard(row, now))}</ul>
          </section>
        ) : null}

        {!activePasses.length && !pastPasses.length ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>
              {showCatalog && resolvedActiveStudioSlug ? (
                packagesList.length > 0 ? (
                  <>
                    You don&apos;t have any class passes yet. <span className="text-stone-700 dark:text-stone-300">Choose a package below to purchase</span> — checkout is on the package page.
                  </>
                ) : studioId ? (
                  <>You don&apos;t have any class passes for this studio yet. This studio hasn&apos;t listed any packages — check back later.</>
                ) : (
                  <>You don&apos;t have any class passes yet. Your selected studio ({resolvedActiveStudioSlug}) hasn&apos;t listed any packages — check back later.</>
                )
              ) : (
                <>You don&apos;t have any class passes yet. When you open this page from a studio (or set your active studio), packages you can buy will appear below.</>
              )}
            </p>
          </div>
        ) : null}

        {pastPasses.length > 0 ? (
          <section className="space-y-3 opacity-60">
            <h2 className={`${ui.h2} text-stone-400 dark:text-stone-500`}>Past passes</h2>
            <ul className="flex flex-col gap-2">{pastPasses.map((row) => passCard(row, now))}</ul>
          </section>
        ) : null}

        {showCatalog && resolvedActiveStudioSlug ? (
          <section className="space-y-3">
            <h2 className={ui.h2}>{activePasses.length ? "Other packages" : "Packages"}</h2>
            <p className={`text-sm ${ui.muted}`}>
              {studioId
                ? "Class pass packs offered by this studio. Purchase opens on the package page."
                : `Class pass packs from your selected studio (${resolvedActiveStudioSlug}). Purchase opens on the package page.`}
            </p>
            {packagesList.length === 0 ? (
              <div className={ui.emptyState}>
                <p className={`text-sm ${ui.muted}`}>No packages listed for this studio yet.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {packagesList.map((pkg) => {
                  const href = pkg.share_slug ? studioPackagePath(resolvedActiveStudioSlug, pkg.share_slug) : studioPackagesPath(resolvedActiveStudioSlug);
                  const expiryLabel = pkg.expiry_days ? `Expires in ${pkg.expiry_days} days` : "No expiry";
                  return (
                    <li key={pkg.id} className={ui.card}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={href} className="font-semibold text-stone-900 transition hover:text-teal-700 dark:text-stone-100 dark:hover:text-teal-400">
                            {pkg.name}
                          </Link>
                          <p className={`mt-1 text-sm ${ui.muted}`}>
                            {pkg.credits} class pass{Number(pkg.credits) !== 1 ? "es" : ""} · {expiryLabel}
                          </p>
                          {pkg.price != null ? (
                            <p className="mt-1 text-sm font-medium tabular-nums text-stone-800 dark:text-stone-200">
                              {STUDIO_CURRENCY} {Number(pkg.price).toFixed(2)}
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
        ) : null}

        <section className="space-y-3">
          <h2 className={ui.h2}>Pass usage history</h2>
          <p className={`text-sm ${ui.muted}`}>Sessions booked using class passes.</p>
          {!usageRows?.length ? (
            <div className={ui.emptyState}>
              <p className={ui.muted}>No class pass usage yet.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {usageRows.map((usage) => {
                const session = Array.isArray(usage.class_sessions) ? usage.class_sessions[0] : usage.class_sessions;
                const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
                const statusBadge = getUnifiedStatusBadges({ booking_status: usage.status }).booking;
                const when = session?.start_time
                  ? new Date(session.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })
                  : "-";
                const usedAt = usage.credit_consumed_at
                  ? new Date(usage.credit_consumed_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })
                  : null;
                return (
                  <li key={usage.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{cls?.title ?? "Class session"}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeToneClass(statusBadge.tone)}`}>
                        {statusBadge.text}
                      </span>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                      <span>{when}</span>
                      <span>
                        Used: {Math.max(0, Number(usage.credits_consumed ?? 0))} pass{Number(usage.credits_consumed ?? 0) !== 1 ? "es" : ""}
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
