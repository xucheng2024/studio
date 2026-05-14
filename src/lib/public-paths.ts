export function studioHomePath(studioSlug: string) {
  return `/${studioSlug}`;
}

export function studioClassesPath(studioSlug: string) {
  return `/${studioSlug}/classes`;
}

export function studioEventsPath(studioSlug: string, tab?: "upcoming" | "past") {
  return `/${studioSlug}/events${tab === "past" ? "?tab=past" : ""}`;
}

export function studioServicesPath(studioSlug: string) {
  return `/${studioSlug}/services`;
}

export function studioPackagesPath(studioSlug: string) {
  return `/${studioSlug}/packages`;
}

export function studioMemberZoneListPath(studioSlug: string) {
  return `/${studioSlug}/member-zone`;
}

export function studioClassPath(
  studioSlug: string,
  classSlug: string,
  query?: string,
) {
  const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `/${studioSlug}/classes/${classSlug}${suffix}`;
}

export function studioEventPath(studioSlug: string, eventSlug: string) {
  return `/${studioSlug}/events/${eventSlug}`;
}

export function studioServicePath(studioSlug: string, serviceSlug: string) {
  return `/${studioSlug}/services/${serviceSlug}`;
}

export function studioPackagePath(studioSlug: string, packageSlug: string) {
  return `/${studioSlug}/packages/${packageSlug}`;
}

export function studioMembershipsPath(studioSlug: string) {
  return `/${studioSlug}/memberships`;
}

export function studioMembershipPath(studioSlug: string, membershipSlug: string) {
  return `/${studioSlug}/memberships/${membershipSlug}`;
}

export function studioMemberZonePath(studioSlug: string, seriesSlug: string) {
  return `/${studioSlug}/member-zone/${seriesSlug}`;
}

export function studioMePath(studioSlug: string, section = "") {
  return `/${studioSlug}/me${section ? `/${section.replace(/^\/+/, "")}` : ""}`;
}

export function studioCheckoutPath(studioSlug: string, paymentId: string) {
  return `/${studioSlug}/checkout/${paymentId}`;
}
