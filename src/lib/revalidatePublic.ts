import { revalidatePath, revalidateTag } from "next/cache";
import { normalizeStudioSlug } from "@/lib/slug";

export const RBAC_CACHE_TAG = "rbac-access-context";
export type PublicContentSection =
  | "services"
  | "classes"
  | "memberships"
  | "events"
  | "packages"
  | "member-zone"
  | "shop";
export type DashboardContentSection =
  | "services"
  | "classes"
  | "memberships"
  | "events"
  | "packages"
  | "member-zone"
  | "shop";
export type DashboardSettingsSection =
  | "owners"
  | "public-profile"
  | "faqs"
  | "booking"
  | "payments"
  | "email"
  | "locations"
  | "staff-invites"
  | "staff-availability"
  | "resources"
  | "privacy";

export function studioPublicCacheTag(publicSlug: string) {
  const slug = normalizeStudioSlug(publicSlug);
  return `studio-public-${slug || "unknown"}`;
}

export function revalidateStudioPublicCache(publicSlug: string | null | undefined) {
  const slug = normalizeStudioSlug(publicSlug ?? "");
  if (!slug) return;
  revalidateTag(studioPublicCacheTag(slug), "max");
}

/** Invalidate ISR path + Data Cache tag for a studio public landing page. */
export function revalidatePublicStudioPath(publicSlug: string | null | undefined) {
  const slug = normalizeStudioSlug(publicSlug ?? "");
  if (!slug) return;
  revalidatePath(`/${slug}`);
  revalidateStudioPublicCache(slug);
}

function detailPathForSection(slug: string, section: PublicContentSection, shareSlug: string) {
  switch (section) {
    case "services":
      return `/${slug}/services/${shareSlug}`;
    case "classes":
      return `/${slug}/classes/${shareSlug}`;
    case "memberships":
      return `/${slug}/memberships/${shareSlug}`;
    case "events":
      return `/${slug}/events/${shareSlug}`;
    case "packages":
      return `/${slug}/packages/${shareSlug}`;
    case "member-zone":
      return `/${slug}/member-zone/${shareSlug}`;
    case "shop":
      return `/${slug}/shop/${shareSlug}`;
  }
}

function listPathForSection(slug: string, section: PublicContentSection) {
  switch (section) {
    case "services":
      return `/${slug}/services`;
    case "classes":
      return `/${slug}/classes`;
    case "memberships":
      return `/${slug}/memberships`;
    case "events":
      return `/${slug}/events`;
    case "packages":
      return `/${slug}/packages`;
    case "member-zone":
      return `/${slug}/member-zone`;
    case "shop":
      return `/${slug}/shop`;
  }
}

export function revalidatePublicSectionPaths(
  publicSlug: string | null | undefined,
  section: PublicContentSection,
  shareSlug?: string | null,
) {
  const slug = normalizeStudioSlug(publicSlug ?? "");
  if (!slug) return;
  revalidatePublicStudioPath(slug);
  revalidatePath(listPathForSection(slug, section));
  const detailSlug = String(shareSlug ?? "").trim();
  if (detailSlug) {
    revalidatePath(detailPathForSection(slug, section, detailSlug));
  }
}

function dashboardContentPaths(section: DashboardContentSection) {
  switch (section) {
    case "services":
      return ["/dashboard/services"];
    case "classes":
      return ["/dashboard/classes", "/dashboard/schedule"];
    case "memberships":
      return ["/dashboard/memberships"];
    case "events":
      return ["/dashboard/events"];
    case "packages":
      return ["/dashboard/packages"];
    case "member-zone":
      return ["/dashboard/member-zone"];
    case "shop":
      return ["/dashboard/shop"];
  }
}

function dashboardSettingsPaths(section: DashboardSettingsSection) {
  switch (section) {
    case "owners":
      return ["/dashboard/settings/owners"];
    case "public-profile":
      return ["/dashboard/settings/public-profile"];
    case "faqs":
      return ["/dashboard/settings", "/dashboard/settings/faqs"];
    case "booking":
      return ["/dashboard/settings", "/dashboard/settings/booking"];
    case "payments":
      return ["/dashboard/settings/payments"];
    case "email":
      return ["/dashboard/settings/email"];
    case "locations":
      return ["/dashboard/settings", "/dashboard/settings/locations", "/dashboard/schedule", "/dashboard/frontdesk", "/dashboard/operations"];
    case "staff-invites":
      return ["/dashboard/settings/staff-invites"];
    case "staff-availability":
      return ["/dashboard/settings/staff-availability"];
    case "resources":
      return ["/dashboard/settings/resources"];
    case "privacy":
      return ["/dashboard/settings", "/dashboard/settings/privacy"];
  }
}

export function revalidateDashboardContent(section: DashboardContentSection) {
  for (const path of dashboardContentPaths(section)) {
    revalidatePath(path);
  }
}

export function revalidateDashboardSettings(section: DashboardSettingsSection) {
  for (const path of dashboardSettingsPaths(section)) {
    revalidatePath(path);
  }
}

export function revalidateDashboardMembershipViews() {
  revalidatePath("/dashboard/memberships");
  revalidatePath("/me/memberships");
}

export function revalidateDashboardStaffViews() {
  revalidatePath("/dashboard/staff");
}

export function revalidateDashboardClientViews(clientId?: string | null) {
  revalidatePath("/dashboard/clients");
  const normalizedClientId = String(clientId ?? "").trim();
  if (normalizedClientId) {
    revalidatePath(`/dashboard/clients/${normalizedClientId}`);
  }
}

export function revalidateDashboardCustomDomainViews() {
  revalidatePath("/dashboard/settings/custom-domain");
}

export function revalidateDashboardCoreViews() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/studios/new");
}

export function revalidateRbacCache() {
  revalidateTag(RBAC_CACHE_TAG, "max");
}
