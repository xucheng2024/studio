export type MerchantSeoStudio = {
  publicSlug: string;
  customDomain: string;
  customDomainStatus: "active" | "pending";
};

export type MerchantSeoRedirectInput = {
  incomingHost: string;
  platformHost: string;
  pathname: string;
  search: string;
  customDomainStudio: MerchantSeoStudio | null;
  platformPathStudio: MerchantSeoStudio | null;
};

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function normalizePath(path: string): string {
  const value = path.trim();
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

export function stripStudioPrefixFromPath(path: string, studioSlug: string): string {
  const normalizedPath = normalizePath(path);
  const slug = studioSlug.trim().toLowerCase();
  if (!slug) return normalizedPath;
  const prefix = `/${slug}`;
  if (normalizedPath === prefix) return "/";
  if (normalizedPath.startsWith(`${prefix}/`)) return normalizedPath.slice(prefix.length);
  return normalizedPath;
}

export function isStudioScopedPath(pathname: string, studioSlug: string): boolean {
  const path = normalizePath(pathname);
  const slug = studioSlug.trim().toLowerCase();
  if (!slug) return false;
  return path === `/${slug}` || path.startsWith(`/${slug}/`);
}

export function isMerchantSeoRedirectSkipped(pathname: string, studioSlug?: string): boolean {
  const path = normalizePath(pathname);
  if (path.startsWith("/api/") || path === "/api") return true;
  if (path.startsWith("/pwa/") || path === "/pwa") return true;
  if (path.startsWith("/.well-known/") || path === "/.well-known") return true;
  if (path.startsWith("/dashboard/") || path === "/dashboard") return true;
  if (
    path === "/auth" ||
    path.startsWith("/auth/") ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/signup" ||
    path.startsWith("/signup/") ||
    path === "/register" ||
    path.startsWith("/register/") ||
    path === "/post-auth" ||
    path.startsWith("/post-auth/") ||
    path === "/account" ||
    path.startsWith("/account/")
  ) {
    return true;
  }
  const slug = studioSlug?.trim().toLowerCase() ?? "";
  if (slug && (path === `/${slug}/auth` || path.startsWith(`/${slug}/auth/`))) return true;
  return false;
}

function destination(host: string, path: string, search: string): string {
  return `https://${host}${path}${search}`;
}

export function getMerchantSeoRedirect(input: MerchantSeoRedirectInput): string | null {
  const incomingHost = normalizeHost(input.incomingHost);
  const platformHost = normalizeHost(input.platformHost);
  const pathname = normalizePath(input.pathname);
  const search = input.search.startsWith("?") || input.search === "" ? input.search : `?${input.search}`;

  if (!incomingHost) return null;

  if (input.customDomainStudio) {
    const slug = input.customDomainStudio.publicSlug.trim().toLowerCase();
    const savedHost = normalizeHost(input.customDomainStudio.customDomain);
    if (!slug || !savedHost) return null;

    const destPath =
      !isMerchantSeoRedirectSkipped(pathname, slug) && isStudioScopedPath(pathname, slug)
        ? stripStudioPrefixFromPath(pathname, slug)
        : pathname;
    const location = destination(savedHost, destPath, search);
    if (incomingHost !== savedHost) return location;
    if (destPath !== pathname) return location;
    return null;
  }

  if (!platformHost || incomingHost !== platformHost || !input.platformPathStudio) return null;
  if (input.platformPathStudio.customDomainStatus !== "active") return null;

  const slug = input.platformPathStudio.publicSlug.trim().toLowerCase();
  const savedHost = normalizeHost(input.platformPathStudio.customDomain);
  if (!slug || !savedHost) return null;
  if (isMerchantSeoRedirectSkipped(pathname, slug)) return null;
  if (!isStudioScopedPath(pathname, slug)) return null;

  return destination(savedHost, stripStudioPrefixFromPath(pathname, slug), search);
}

export function merchantSitemapListPaths(input: {
  studioSlug: string;
  hasServices?: boolean;
  hasClasses?: boolean;
  hasEvents?: boolean;
  hasPackages?: boolean;
  hasMemberships?: boolean;
  hasMemberZone?: boolean;
  hasShop?: boolean;
}): string[] {
  const slug = input.studioSlug.trim().toLowerCase();
  if (!slug) return [];
  const pages: Array<[boolean | undefined, string]> = [
    [input.hasServices, `/${slug}/services`],
    [input.hasClasses, `/${slug}/classes`],
    [input.hasEvents, `/${slug}/events`],
    [input.hasPackages, `/${slug}/packages`],
    [input.hasMemberships, `/${slug}/memberships`],
    [input.hasMemberZone, `/${slug}/member-zone`],
    [input.hasShop, `/${slug}/shop`],
  ];
  return pages
    .filter(([include]) => Boolean(include))
    .map(([, path]) => stripStudioPrefixFromPath(path, slug));
}
