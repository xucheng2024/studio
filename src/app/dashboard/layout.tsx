import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/DashboardNav";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import { StudioSwitcher } from "@/components/StudioSwitcher";
import { bestRole, buildAccessContext } from "@/lib/rbac";
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
  const ctx = await buildAccessContext({ userId: user.id });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) redirect("/booking");
  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const { data: studios } = await supabase
    .from("studios")
    .select("id, name")
    .in("id", studioIds)
    .order("name");

  return (
    <div className={`${ui.pageWide} flex min-h-[calc(100dvh-3.5rem)] flex-col gap-8 md:flex-row md:gap-10`}>
      <aside className={`flex w-full shrink-0 flex-col gap-5 md:w-56 ${ui.sidebar}`}>
        <div>
          <Link href="/dashboard" className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Owner dashboard
          </Link>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">Manage your studio</p>
        </div>
        <StudioSwitcher studios={(studios ?? []).map((s) => ({ id: s.id, name: s.name }))} />
        <LocationSwitcher
          locations={ctx.locations.map((l) => ({ id: l.id, name: l.name }))}
        />
        <DashboardNav />
        <SignOutButton />
      </aside>
      <section className="min-w-0 flex-1 pb-8">{children}</section>
    </div>
  );
}
