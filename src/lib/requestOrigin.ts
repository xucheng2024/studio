import { headers } from "next/headers";
import { getAppOriginForOg } from "@/lib/coverMedia";

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

function normalizeCustomDomain(domain: string | null | undefined): string {
  return (domain ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function stripStudioPrefix(path: string, studioSlug: string): string {
  const normalizedPath = normalizePath(path);
  const prefix = `/${studioSlug}`;
  if (normalizedPath === prefix) return "/";
  if (normalizedPath.startsWith(`${prefix}/`)) return normalizedPath.slice(prefix.length);
  return normalizedPath;
}

export async function getCanonicalPathForStudioPath(path: string, studioSlug: string): Promise<string> {
  const normalizedStudioSlug = studioSlug.trim().toLowerCase();
  const normalizedPath = normalizePath(path);
  if (!normalizedStudioSlug) return normalizedPath;

  try {
    const h = await headers();
    const requestStudioSlug = (h.get("x-studio-slug") ?? "").trim().toLowerCase();
    if (requestStudioSlug && requestStudioSlug === normalizedStudioSlug) {
      return stripStudioPrefix(normalizedPath, normalizedStudioSlug);
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
  const normalizedCustomDomain =
    customDomainStatus === "active" ? normalizeCustomDomain(customDomain) : "";

  if (normalizedCustomDomain && normalizedStudioSlug) {
    return `https://${normalizedCustomDomain}${stripStudioPrefix(normalizedPath, normalizedStudioSlug)}`;
  }

  const origin = await getRequestOriginForOg();
  const canonicalPath = await getCanonicalPathForStudioPath(normalizedPath, normalizedStudioSlug);
  return origin ? `${origin}${canonicalPath}` : canonicalPath;
}
