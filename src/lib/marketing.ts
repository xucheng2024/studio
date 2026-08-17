import "server-only";

import { buildAccessContext, type StaffRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

export type MarketingAudienceType = "vip" | "frequent" | "inactive";

type MarketingActor = {
  userId: string;
  email: string | null;
  studioId: string;
  locationId: string | null;
};

function actorRole(ctx: Awaited<ReturnType<typeof buildAccessContext>>, studioId: string, locationId: string | null): "owner" | "manager" | null {
  const memberships = ctx.memberships.filter((membership) =>
    membership.studio_id === studioId
    && (membership.role === "owner" || membership.role === "manager")
    && (membership.location_id == null || membership.location_id === locationId),
  );
  const role = memberships.some((membership) => membership.role === "owner") ? "owner" : memberships[0]?.role;
  return role === "owner" || role === "manager" ? role : null;
}

export async function createMarketingCampaignSnapshot(input: MarketingActor & {
  name: string;
  audienceType: MarketingAudienceType;
  minValue: number;
  minVisits: number;
  inactiveDays: number;
  subject: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}) {
  const ctx = await buildAccessContext(input.userId, input.email, input.locationId);
  const role = actorRole(ctx, input.studioId, input.locationId);
  if (!role) return { ok: false as const, message: "You do not have marketing access for this studio." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mkt01_create_campaign_snapshot", {
    p_actor_id: input.userId,
    p_actor_role: role as StaffRole,
    p_studio_id: input.studioId,
    p_location_id: input.locationId,
    p_name: input.name,
    p_audience_type: input.audienceType,
    p_min_value: input.minValue,
    p_min_visits: input.minVisits,
    p_inactive_days: input.inactiveDays,
    p_subject: input.subject,
    p_body: input.body,
    p_image_url: input.imageUrl,
    p_cta_label: input.ctaLabel,
    p_cta_url: input.ctaUrl,
  });
  if (error || !data || typeof data !== "object") return { ok: false as const, message: error?.message ?? "Could not create the campaign snapshot." };
  const result = data as { campaign_id?: string; recipient_count?: number; eligible_count?: number };
  return { ok: true as const, campaignId: result.campaign_id ?? "", recipientCount: Number(result.recipient_count ?? 0), eligibleCount: Number(result.eligible_count ?? 0) };
}
