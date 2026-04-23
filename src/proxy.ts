import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_MEMBER_STUDIO_COOKIE, parseStudioSlugFromPath } from "@/lib/member-studio-shared";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

function isSuperAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  const raw = process.env.SUPER_ADMIN_EMAILS ?? "";
  const allow = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const studioSlug = parseStudioSlugFromPath(request.nextUrl.pathname);
  const studioCookie = studioSlug
    ? {
        name: ACTIVE_MEMBER_STUDIO_COOKIE,
        value: studioSlug,
        options: {
          path: "/",
          sameSite: "lax" as const,
          httpOnly: false,
          secure: request.nextUrl.protocol === "https:",
          maxAge: 60 * 60 * 24 * 30,
        },
      }
    : null;
  if (studioCookie) response.cookies.set(studioCookie.name, studioCookie.value, studioCookie.options);

  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (studioCookie) response.cookies.set(studioCookie.name, studioCookie.value, studioCookie.options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  if (
    user &&
    isSuperAdminEmail(user.email) &&
    pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/dashboard/settings/owners")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard/settings/owners";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (studioCookie) response.cookies.set(studioCookie.name, studioCookie.value, studioCookie.options);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
