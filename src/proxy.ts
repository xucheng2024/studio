import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isPlatformHost,
  resolveActiveCustomDomainStudio,
  resolveStudioCustomDomainBySlug,
} from "@/lib/customDomainLookup";
import { ACTIVE_MEMBER_STUDIO_COOKIE, parseStudioSlugFromPath } from "@/lib/member-studio-shared";
import { getMerchantSeoRedirect } from "@/lib/merchantSeo";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

const APP_HOSTNAME = (process.env.NEXT_PUBLIC_APP_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/:\d+$/, "")
  .toLowerCase();

function shouldSkipCustomDomainRewrite(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname === "/api") return true;
  if (pathname.startsWith("/pwa/") || pathname === "/pwa") return true;
  if (pathname.startsWith("/.well-known/") || pathname === "/.well-known") return true;
  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return true;
  if (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/register" ||
    pathname === "/post-auth" ||
    pathname.startsWith("/post-auth/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/")
  ) {
    return true;
  }
  return pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/manifest.webmanifest";
}

function isAlreadyScopedToStudio(pathname: string, studioSlug: string): boolean {
  return pathname === `/${studioSlug}` || pathname.startsWith(`/${studioSlug}/`);
}

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
  // Custom domain rewrite: if the incoming host is not our own app domain,
  // look up the studio and rewrite internally so the browser URL stays unchanged.
  const incomingHost = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  const customDomainStudio =
    incomingHost && APP_HOSTNAME && incomingHost !== APP_HOSTNAME
      ? await resolveActiveCustomDomainStudio(incomingHost)
      : null;
  const pathSlug = parseStudioSlugFromPath(request.nextUrl.pathname);
  const platformPathStudio =
    !customDomainStudio && pathSlug && APP_HOSTNAME && isPlatformHost(incomingHost)
      ? await resolveStudioCustomDomainBySlug(pathSlug)
      : null;
  const seoRedirect = getMerchantSeoRedirect({
    incomingHost,
    platformHost: APP_HOSTNAME,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    customDomainStudio,
    platformPathStudio,
  });
  if (seoRedirect) {
    return NextResponse.redirect(seoRedirect, 301);
  }
  const customDomainSlug = customDomainStudio?.publicSlug ?? null;
  if (
    customDomainSlug &&
    !shouldSkipCustomDomainRewrite(request.nextUrl.pathname) &&
    !isAlreadyScopedToStudio(request.nextUrl.pathname, customDomainSlug)
  ) {
    const { pathname, search } = request.nextUrl;
    const rewriteUrl = new URL(`/${customDomainSlug}${pathname === "/" ? "" : pathname}${search}`, request.url);
    const rewriteHeaders = new Headers(request.headers);
    rewriteHeaders.set("x-studio-slug", customDomainSlug);
    return NextResponse.rewrite(rewriteUrl, { request: { headers: rewriteHeaders } });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-studio-slug");
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  if (customDomainSlug) requestHeaders.set("x-studio-slug", customDomainSlug);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
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

  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/dashboard")) {
    if (studioCookie) response.cookies.set(studioCookie.name, studioCookie.value, studioCookie.options);
    return response;
  }

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
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (studioCookie) response.cookies.set(studioCookie.name, studioCookie.value, studioCookie.options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    // Broad catch-all for custom domain rewriting (excludes Next.js internals and static files)
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
