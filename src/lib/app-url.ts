const CUSTOM_DOMAIN_STUDIO_HEADER = "x-studio-slug";

function normalizeHost(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export function getAppBaseUrlFromRequest(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const requestBase = `${proto}://${host}`;
    if (env) {
      const envHost = normalizeHost(env);
      const requestHost = normalizeHost(host);
      const requestStudioSlug = (req.headers.get(CUSTOM_DOMAIN_STUDIO_HEADER) ?? "").trim().toLowerCase();
      if (requestHost && envHost && requestHost !== envHost && requestStudioSlug) {
        return requestBase;
      }
    } else {
      return requestBase;
    }
  }
  if (env) return env;
  if (!host) return "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export function getStudioPathPrefixFromRequest(req: Request, studioSlug: string): string {
  const requestStudioSlug = (req.headers.get(CUSTOM_DOMAIN_STUDIO_HEADER) ?? "").trim().toLowerCase();
  return requestStudioSlug && requestStudioSlug === studioSlug.trim().toLowerCase() ? "" : `/${studioSlug}`;
}

export function getStudioUrlFromRequest(req: Request, studioSlug: string, path = ""): string {
  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) return "";

  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${baseUrl}${getStudioPathPrefixFromRequest(req, studioSlug)}${normalizedPath}`;
}

export function getStudioPathFromRequest(req: Request, studioSlug: string, path = ""): string {
  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  const prefix = getStudioPathPrefixFromRequest(req, studioSlug);
  return `${prefix}${normalizedPath}` || "/";
}

export function getStudioPublicUrl(
  studioSlug: string,
  path = "",
  customDomain?: string | null,
  customDomainStatus?: string | null,
): string {
  const normalizedCustomDomain = customDomainStatus === "active" ? normalizeHost(customDomain) : "";
  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  if (normalizedCustomDomain) {
    return `https://${normalizedCustomDomain}${normalizedPath}`;
  }

  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!env) return "";
  return `${env}/${studioSlug}${normalizedPath}`;
}
