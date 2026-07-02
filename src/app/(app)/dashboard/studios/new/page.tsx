import { redirect } from "next/navigation";
import { CreateStudioForm } from "@/components/dashboard/CreateStudioForm";
import { resolveAccessContext } from "@/lib/rbac";
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

  return (
    <div className="max-w-lg">
      <h1 className={ui.h1}>Add studio</h1>
      <p className={`mt-2 ${ui.lead}`}>Create another studio under your owner account.</p>
      <CreateStudioForm />
    </div>
  );
}
