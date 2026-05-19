import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { resolveAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const getMembershipLinkFlag = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("membership_products")
      .select("id")
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    return Boolean(data?.id);
  },
  ["header-membership-link-flag"],
  { revalidate: 60 },
);

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      isLoggedIn: false,
      hasBackofficeAccess: false,
      userInitial: null,
      showMembershipsLink: false,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const showMembershipsLink = await getMembershipLinkFlag();
  if (!user) {
    return NextResponse.json({
      isLoggedIn: false,
      hasBackofficeAccess: false,
      userInitial: null,
      showMembershipsLink,
    });
  }

  const access = await resolveAccessContext({ userId: user.id, email: user.email });
  const userInitial =
    user.email?.trim().charAt(0).toUpperCase() || user.id?.charAt(0).toUpperCase() || "U";

  return NextResponse.json({
    isLoggedIn: true,
    hasBackofficeAccess: access.hasBackofficeAccess,
    userInitial,
    showMembershipsLink,
  });
}
