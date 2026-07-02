import { redirect } from "next/navigation";
import { CreateStudioForm } from "@/components/dashboard/CreateStudioForm";
import { resolveAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function NewStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  if (access.bestRole !== "owner" && !access.ctx.isSuperAdmin) {
    return <p className={ui.muted}>Only studio owners can create a new studio.</p>;
  }
  if (!access.ctx.isSuperAdmin) {
    const admin = createAdminClient();
    const [{ data: grant }, { count: studioCount }] = await Promise.all([
      admin
        .from("platform_owner_grants")
        .select("is_active, studio_limit")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin.from("studios").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    ]);
    const studioLimit =
      typeof grant?.studio_limit === "number" && grant.studio_limit >= 1 ? grant.studio_limit : 1;
    if (!grant?.is_active) {
      return <p className={ui.muted}>Your platform owner access is not active.</p>;
    }
    if ((studioCount ?? 0) >= studioLimit) {
      return <p className={ui.muted}>Studio limit reached ({studioCount ?? 0}/{studioLimit}). Ask a platform admin to increase your owner limit.</p>;
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className={ui.h1}>Add studio</h1>
      <p className={`mt-2 ${ui.lead}`}>Create another studio under your owner account.</p>
      <CreateStudioForm />
    </div>
  );
}
