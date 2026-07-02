import { redirect } from "next/navigation";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardNav, MobileBottomNav } from "@/components/DashboardNav";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import { StudioSwitcher } from "@/components/StudioSwitcher";
import { resolveAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Plus } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  const ctx = access.ctx;
  const role = access.bestRole;
  const resolvedRole: "owner" | "manager" | "frontdesk" =
    role === "owner" || ctx.isSuperAdmin
      ? "owner"
      : role === "manager"
        ? "manager"
        : "frontdesk";

  if (!access.hasBackofficeAccess || role === "instructor") {
    if (!access.hasBackofficeAccess && access.hasSuspendedBackofficeAccess) {
      redirect("/account/suspended");
    }
    redirect("/");
  }

  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const superAdminNoStudioMode = ctx.isSuperAdmin;
  const ownerNoStudioMode = !superAdminNoStudioMode && studioIds.length === 0;
  let canCreateStudio = resolvedRole === "owner" && !superAdminNoStudioMode;
  let ownerStudioLimit: number | null = null;
  let ownerStudioCount = 0;

  if (resolvedRole === "owner" && !superAdminNoStudioMode) {
    const admin = createAdminClient();
    const [{ data: grant }, { count: ownedStudioCount }] = await Promise.all([
      admin
        .from("platform_owner_grants")
        .select("is_active, studio_limit")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin.from("studios").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    ]);
    ownerStudioLimit =
      typeof grant?.studio_limit === "number" && grant.studio_limit >= 1 ? grant.studio_limit : 1;
    ownerStudioCount = ownedStudioCount ?? 0;
    canCreateStudio = Boolean(grant?.is_active) && ownerStudioCount < ownerStudioLimit;
  }

  const { data: studios } =
    studioIds.length > 0
      ? await supabase
          .from("studios")
          .select("id, name, contract_status")
          .in("id", studioIds)
          .order("name")
      : { data: [] as { id: string; name: string; contract_status: string | null }[] };

  const homeHref = superAdminNoStudioMode
    ? "/dashboard/settings/owners"
    : ownerNoStudioMode
      ? "/dashboard/overview"
      : "/dashboard/operations";

  const homeLabel = superAdminNoStudioMode
    ? "Platform admin"
    : ownerNoStudioMode
      ? "Get started"
      : "Front desk";

  const homeSub = superAdminNoStudioMode
    ? "Manage owner access"
    : ownerNoStudioMode
      ? "Create your first studio"
      : "Manage your studio";

  return (
    <>
      {/* ── Mobile bottom navigation ─────────────────────────────── */}
      {!ownerNoStudioMode && (
        <MobileBottomNav
          role={resolvedRole}
          superAdminNoStudioMode={superAdminNoStudioMode}
        />
      )}

      <div
        className={`${ui.pageWide} flex min-h-[calc(100dvh-3.5rem)] flex-col gap-6 md:flex-row md:gap-8`}
      >
        {/* ── Desktop sidebar ───────────────────────────────────── */}
        <aside
          className={`hidden w-52 shrink-0 flex-col gap-4 md:flex ${ui.sidebar} self-start sticky top-20`}
        >
          {/* Brand / context heading */}
          <div>
            <DashboardAppLink
              href={homeHref}
              className="block text-sm font-semibold text-stone-900 dark:text-stone-100"
            >
              {homeLabel}
            </DashboardAppLink>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{homeSub}</p>
          </div>

          {/* Studio switcher */}
          {!superAdminNoStudioMode && !ownerNoStudioMode && (
            <div className="flex flex-col gap-2">
              <StudioSwitcher
                studios={(studios ?? []).map((s) => ({
                  id: s.id,
                  name: s.name,
                  contract_status: s.contract_status,
                }))}
              />
              {canCreateStudio ? (
                <DashboardAppLink
                  href="/dashboard/studios/new"
                  className={`${ui.btnSecondarySm} w-full justify-center`}
                >
                  <Plus size={15} />
                  Add studio
                </DashboardAppLink>
              ) : null}
            </div>
          )}

          {/* No studio yet notice */}
          {studioIds.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">
                {superAdminNoStudioMode ? "No owner workspace yet" : "No studio yet"}
              </p>
              <p className="mt-1 leading-snug">
                {superAdminNoStudioMode
                  ? "Grant owner access first, then owners can create and manage studios."
                  : canCreateStudio
                    ? "Create your first studio from overview to unlock operations."
                    : ownerStudioLimit != null
                      ? `Studio limit reached (${ownerStudioCount}/${ownerStudioLimit}). Ask a platform admin to increase your owner limit.`
                      : "Create your first studio from overview to unlock operations."}
              </p>
              {superAdminNoStudioMode || canCreateStudio ? (
                <DashboardAppLink
                  href={superAdminNoStudioMode ? "/dashboard/settings/owners" : "/dashboard/overview"}
                  className="mt-2 inline-block font-medium underline underline-offset-2"
                >
                  {superAdminNoStudioMode ? "Manage owner access" : "Create studio"}
                </DashboardAppLink>
              ) : null}
            </div>
          )}

          {/* Location switcher */}
          {!superAdminNoStudioMode && !ownerNoStudioMode && (
            <LocationSwitcher
              locations={ctx.locations.map((l) => ({ id: l.id, name: l.name }))}
              selectedLocationId={ctx.selectedLocationId}
              allowAll={ctx.isSuperAdmin || ctx.hasAnyGlobalLocationAccess}
            />
          )}

          {/* Nav links */}
          {!ownerNoStudioMode && (
            <DashboardNav
              role={resolvedRole}
              superAdminNoStudioMode={superAdminNoStudioMode}
            />
          )}

          <SignOutButton />
        </aside>

        {/* ── Mobile top context bar (studio name + switchers) ──── */}
        <div className="flex flex-col gap-3 pt-2 md:hidden">
          {!superAdminNoStudioMode && !ownerNoStudioMode && (
            <>
              <div className="flex flex-col gap-2">
                <StudioSwitcher
                  studios={(studios ?? []).map((s) => ({
                    id: s.id,
                    name: s.name,
                    contract_status: s.contract_status,
                  }))}
                />
                {canCreateStudio ? (
                  <DashboardAppLink
                    href="/dashboard/studios/new"
                    className={`${ui.btnSecondarySm} w-full justify-center`}
                  >
                    <Plus size={15} />
                    Add studio
                  </DashboardAppLink>
                ) : null}
              </div>
              <LocationSwitcher
                locations={ctx.locations.map((l) => ({ id: l.id, name: l.name }))}
                selectedLocationId={ctx.selectedLocationId}
                allowAll={ctx.isSuperAdmin || ctx.hasAnyGlobalLocationAccess}
              />
            </>
          )}
          {studioIds.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">
                {superAdminNoStudioMode ? "No owner workspace yet" : "No studio yet"}
              </p>
              {!superAdminNoStudioMode && !canCreateStudio && ownerStudioLimit != null ? (
                <p className="mt-1 leading-snug">
                  Studio limit reached ({ownerStudioCount}/{ownerStudioLimit}). Ask a platform admin to increase your owner limit.
                </p>
              ) : null}
              {superAdminNoStudioMode || canCreateStudio ? (
                <DashboardAppLink
                  href={superAdminNoStudioMode ? "/dashboard/settings/owners" : "/dashboard/overview"}
                  className="mt-1 inline-block font-medium underline underline-offset-2"
                >
                  {superAdminNoStudioMode ? "Manage owner access" : "Create studio"}
                </DashboardAppLink>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Main content ─────────────────────────────────────── */}
        <section className={ui.pageDash}>{children}</section>
      </div>
    </>
  );
}
