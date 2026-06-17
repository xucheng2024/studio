import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_MEMBER_STUDIO_COOKIE, parseStudioSlugFromPath } from "@/lib/member-studio-shared";
import { resolveStudioSlugForCustomHost } from "@/lib/member-auth.server";
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
    const studioSlug =
      parseStudioSlugFromPath(safeNext) ||
      await resolveStudioSlugForCustomHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    if (user?.id && studioSlug) {
      response.cookies.set(ACTIVE_MEMBER_STUDIO_COOKIE, studioSlug, {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        secure: request.nextUrl.protocol === "https:",
        maxAge: 60 * 60 * 24 * 30,
      });
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
