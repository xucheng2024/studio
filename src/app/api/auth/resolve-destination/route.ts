import { NextResponse } from "next/server";
import { resolveAccessContext } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  const hasBackofficeDashboardRole =
    access.ctx.isSuperAdmin ||
    access.ctx.roles.has("owner") ||
    access.ctx.roles.has("manager") ||
    access.ctx.roles.has("frontdesk");
  const destination =
    !access.hasBackofficeAccess && access.hasSuspendedBackofficeAccess
      ? "/account/suspended"
      : access.ctx.roles.has("instructor") && !hasBackofficeDashboardRole
        ? "/instructor/sessions"
        : access.hasBackofficeAccess
          ? "/dashboard/operations"
          : "/";

  return NextResponse.json({
    destination,
  });
}
