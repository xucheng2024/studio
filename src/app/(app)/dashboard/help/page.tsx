import { HelpCenter } from "@/components/dashboard/HelpCenter";
import { resolveAccessContext } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string; help_topic?: string }>;
};

export default async function DashboardHelpPage({ searchParams }: Props) {
  const [sp, supabase] = await Promise.all([searchParams, createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  const role = access.bestRole;
  const resolvedRole: "owner" | "manager" | "frontdesk" | "instructor" =
    role === "owner" || access.ctx.isSuperAdmin
      ? "owner"
      : role === "manager"
        ? "manager"
        : role === "instructor"
          ? "instructor"
          : "frontdesk";

  const scoped = new URLSearchParams();
  if (sp.studio_id) scoped.set("studio_id", sp.studio_id);
  if (sp.location_id) scoped.set("location_id", sp.location_id);

  return <HelpCenter role={resolvedRole} search={scoped.toString()} topic={sp.help_topic} />;
}
