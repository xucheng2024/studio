import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/DashboardNav";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import { StudioSwitcher } from "@/components/StudioSwitcher";
import { resolveAccessContext } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

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
    role === "owner" || access.ctx.isSuperAdmin
      ? "owner"
      : role === "manager"
        ? "manager"
        : "frontdesk";
  if (!access.hasBackofficeAccess || role === "instructor") {
    if (!access.hasBackofficeAccess && access.hasSuspendedBackofficeAccess) {
      redirect("/account/suspended");
    }
    redirect("/booking");
  }
  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const superAdminNoStudioMode = access.ctx.isSuperAdmin;
  const { data: studios } =
    studioIds.length > 0
          ? await supabase
          .from("studios")
          .select("id, name, contract_status")
          .in("id", studioIds)
          .order("name")
      : { data: [] as { id: string; name: string; contract_status: string | null }[] };

  return (
    <div className={`${ui.pageWide} flex min-h-[calc(100dvh-3.5rem)] flex-col gap-8 md:flex-row md:gap-10`}>
      <aside className={`flex w-full shrink-0 flex-col gap-5 md:w-56 ${ui.sidebar}`}>
        <div>
          <Link
            href={superAdminNoStudioMode ? "/dashboard/settings/owners" : "/dashboard/operations"}
            className="text-sm font-semibold text-stone-900 dark:text-stone-100"
          >
            {superAdminNoStudioMode ? "Platform admin" : "Operations hub"}
          </Link>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            {superAdminNoStudioMode ? "Manage owner access" : "Manage your studio"}
          </p>
        </div>
        {!superAdminNoStudioMode ? (
          <StudioSwitcher
            studios={(studios ?? []).map((s) => ({
              id: s.id,
              name: s.name,
              contract_status: s.contract_status,
            }))}
          />
        ) : null}
        {studioIds.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">{superAdminNoStudioMode ? "No owner workspace yet" : "No studio yet"}</p>
            <p className="mt-1">
              {superAdminNoStudioMode
                ? "Grant owner access first, then owners can create and manage their studios."
                : "Create your first studio from overview to unlock operations."}
            </p>
            <Link
              href={superAdminNoStudioMode ? "/dashboard/settings/owners" : "/dashboard/overview"}
              className="mt-2 inline-block underline underline-offset-2"
            >
              {superAdminNoStudioMode ? "Manage owner access" : "Create studio"}
            </Link>
          </div>
        ) : null}
        {!superAdminNoStudioMode ? (
          <LocationSwitcher
            locations={ctx.locations.map((l) => ({ id: l.id, name: l.name }))}
          />
        ) : null}
        <DashboardNav role={resolvedRole} superAdminNoStudioMode={superAdminNoStudioMode} />
        <SignOutButton />
      </aside>
      <section className="min-w-0 flex-1 pb-8">{children}</section>
    </div>
  );
}
