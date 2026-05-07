import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { parseStudioSlugFromPath } from "@/lib/member-studio-shared";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/post-auth";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/post-auth";

  const redirectUrl = new URL(safeNext, request.url);
  const response = NextResponse.redirect(redirectUrl);

  if (code) {
    const supabase = createServerClient(
      getSupabaseUrl()!,
      getSupabaseAnonKey()!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );
    await supabase.auth.exchangeCodeForSession(code);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const studioSlug = parseStudioSlugFromPath(safeNext);
    if (user?.id && studioSlug) {
      const admin = createAdminClient();
      const { data: studio } = await admin
        .from("studios")
        .select("id")
        .eq("public_slug", studioSlug)
        .maybeSingle();
      if (studio?.id) {
        await upsertMemberStudioMembership(admin, { userId: user.id, studioId: studio.id });
      }
    }
  }

  return response;
}
