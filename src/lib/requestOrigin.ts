import { headers } from "next/headers";
import { getAppOriginForOg } from "@/lib/coverMedia";
import { isCustomDomainHostMatch, normalizeCustomDomainInput } from "@/lib/customDomain";
import { stripStudioPrefixFromPath } from "@/lib/merchantSeo";

export async function getRequestOriginForOg(): Promise<string> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").trim();
    if (host) {
      const proto = (h.get("x-forwarded-proto") ?? "https").trim();
      return `${proto}://${host.replace(/\/$/, "")}`;
    }
  } catch {
    // Fall through to env-based origin.
  }
  return getAppOriginForOg();
}

function normalizePath(path: string): string {
  const value = path.trim();
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

function hostFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function requestIsOnStudioCustomDomain(
  studioSlug: string,
  customDomain: string,
): Promise<boolean> {
  try {
    const h = await headers();
    const requestStudioSlug = (h.get("x-studio-slug") ?? "").trim().toLowerCase();
    if (requestStudioSlug && requestStudioSlug === studioSlug) return true;
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").trim();
    return isCustomDomainHostMatch(host, customDomain);
  } catch {
    return false;
  }
}

export async function getCanonicalPathForStudioPath(path: string, studioSlug: string): Promise<string> {
  const normalizedStudioSlug = studioSlug.trim().toLowerCase();
  const normalizedPath = normalizePath(path);
  if (!normalizedStudioSlug) return normalizedPath;

  try {
    const h = await headers();
    const requestStudioSlug = (h.get("x-studio-slug") ?? "").trim().toLowerCase();
    if (requestStudioSlug && requestStudioSlug === normalizedStudioSlug) {
      return stripStudioPrefixFromPath(normalizedPath, normalizedStudioSlug);
    }
  } catch {
    // Fall through to slug-scoped path.
  }

  return normalizedPath;
}

export async function getCanonicalUrlForStudioPath(
  path: string,
  studioSlug: string,
  customDomain?: string | null,
  customDomainStatus?: string | null,
): Promise<string> {
  const normalizedStudioSlug = studioSlug.trim().toLowerCase();
  const normalizedPath = normalizePath(path);
  const savedDomain = normalizeCustomDomainInput(customDomain ?? "");
  const strippedPath = stripStudioPrefixFromPath(normalizedPath, normalizedStudioSlug);

  if (savedDomain && normalizedStudioSlug && customDomainStatus === "active") {
    return `https://${savedDomain}${strippedPath}`;
  }

  if (
    savedDomain &&
    normalizedStudioSlug &&
    (customDomainStatus === "pending" || customDomainStatus === "active") &&
    (await requestIsOnStudioCustomDomain(normalizedStudioSlug, savedDomain))
  ) {
    return `https://${savedDomain}${strippedPath}`;
  }

  const origin = await getRequestOriginForOg();
  if (savedDomain && isCustomDomainHostMatch(hostFromOrigin(origin), savedDomain)) {
    return `https://${savedDomain}${strippedPath}`;
  }

  const canonicalPath = await getCanonicalPathForStudioPath(normalizedPath, normalizedStudioSlug);
  return origin ? `${origin}${canonicalPath}` : canonicalPath;
}
