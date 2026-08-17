"use server";

import { revalidatePath } from "next/cache";
import { sendMarketingTestEmail } from "@/lib/email";
import { createMarketingCampaignSnapshot, type MarketingAudienceType } from "@/lib/marketing";
import { err, ok, requireUser, requireStudio, type DashboardFormResult } from "./shared";

const audienceTypes = new Set<MarketingAudienceType>(["vip", "frequent", "inactive"]);

function numberInRange(raw: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function text(raw: FormDataEntryValue | null) { return String(raw ?? "").trim(); }

export async function createMarketingCampaignAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const locationId = text(formData.get("location_id")) || null;
  const audienceType = text(formData.get("audience_type")) as MarketingAudienceType;
  const name = text(formData.get("name"));
  const subject = text(formData.get("subject"));
  const body = String(formData.get("body") ?? "").trim();
  const imageUrl = text(formData.get("image_url")) || null;
  const ctaLabel = text(formData.get("cta_label")) || null;
  const ctaUrl = text(formData.get("cta_url")) || null;
  if (!studioId || !name || !subject || !body || !audienceTypes.has(audienceType)) return err("Provide a campaign name, audience, subject, and message.");
  if ((ctaLabel == null) !== (ctaUrl == null) || (ctaUrl && !ctaUrl.startsWith("https://"))) return err("CTA label and a secure https:// URL must be provided together.");
  if (imageUrl && !imageUrl.startsWith("https://")) return err("Image URL must use https://.");

  const { user } = await requireUser();
  const result = await createMarketingCampaignSnapshot({
    userId: user.id, email: user.email ?? null, studioId, locationId, name, audienceType, subject, body, imageUrl, ctaLabel, ctaUrl,
    minValue: numberInRange(formData.get("min_value"), 1000, 0, 1_000_000),
    minVisits: Math.floor(numberInRange(formData.get("min_visits"), 3, 1, 10_000)),
    inactiveDays: Math.floor(numberInRange(formData.get("inactive_days"), 90, 1, 3650)),
  });
  if (!result.ok) return err(result.message);
  revalidatePath("/dashboard/marketing");
  return ok(`Draft saved with ${result.eligibleCount} consented recipients (${result.recipientCount} in snapshot).`);
}

export async function sendMarketingTestEmailAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const to = text(formData.get("test_email"));
  const subject = text(formData.get("subject"));
  const body = String(formData.get("body") ?? "").trim();
  const imageUrl = text(formData.get("image_url")) || null;
  const ctaLabel = text(formData.get("cta_label")) || null;
  const ctaUrl = text(formData.get("cta_url")) || null;
  if (!studioId || !/^\S+@\S+\.\S+$/.test(to) || !subject || !body) return err("Provide a valid test email, subject, and message.");
  if ((ctaLabel == null) !== (ctaUrl == null) || (ctaUrl && !ctaUrl.startsWith("https://"))) return err("CTA label and a secure https:// URL must be provided together.");
  if (imageUrl && !imageUrl.startsWith("https://")) return err("Image URL must use https://.");
  const { ctx, studio } = await requireStudio(studioId);
  if (!studio || !ctx.memberships.some((m) => m.studio_id === studioId && (m.role === "owner" || m.role === "manager"))) return err("You do not have marketing access for this studio.");
  const result = await sendMarketingTestEmail({ to, subject, body, imageUrl, ctaLabel, ctaUrl });
  if (result.skipped) return err(result.error ? "Test email could not be sent." : "Email is not configured in this environment.");
  return ok(`Test email sent to ${to}.`);
}
