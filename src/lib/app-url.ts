export function getAppBaseUrlFromRequest(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const requestBase = `${proto}://${host}`;
    if (env) {
      const envHost = env.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").toLowerCase();
      const requestHost = host.replace(/:\d+$/, "").toLowerCase();
      if (requestHost && envHost && requestHost !== envHost) {
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
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || !env) return `/${studioSlug}`;

  const envHost = env.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").toLowerCase();
  const requestHost = host.replace(/:\d+$/, "").toLowerCase();
  return requestHost && envHost && requestHost !== envHost ? "" : `/${studioSlug}`;
}

export function getStudioUrlFromRequest(req: Request, studioSlug: string, path = ""): string {
  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) return "";

  const normalizedPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${baseUrl}${getStudioPathPrefixFromRequest(req, studioSlug)}${normalizedPath}`;
}
