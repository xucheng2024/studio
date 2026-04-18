/** Path segment of an href without query string. */
export function pathFromHref(href: string): string {
  return href.split("?")[0] || href;
}

/**
 * Whether the current pathname matches a nav target (exact or subpath).
 * `/dashboard` and `/` only match exactly so they don’t light up every child route.
 */
export function isRouteActive(pathname: string, href: string): boolean {
  const t = pathFromHref(href);
  if (pathname === t) return true;
  if (t === "/dashboard" || t === "/") return false;
  return pathname.startsWith(`${t}/`);
}
