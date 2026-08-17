import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimProviderEvent, completeProviderEvent, failProviderEvent, hashProviderPayload } from "@/lib/provider-events";
import { resendEventMetadata, verifyResendWebhook } from "@/lib/marketing-dispatch";

const supported = new Set(["email.sent", "email.delivered", "email.delivery_delayed", "email.failed", "email.bounced", "email.complained", "email.suppressed", "email.clicked"]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  let event;
  try {
    event = verifyResendWebhook(rawBody, request.headers);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const eventId = request.headers.get("svix-id")!;
  if (!supported.has(event.type) || !("email_id" in event.data)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const admin = createAdminClient();
  const { data: recipient } = await admin.from("marketing_campaign_recipients")
    .select("id, studio_id, campaign_id, marketing_campaigns(location_id)")
    .eq("provider_email_id", event.data.email_id).maybeSingle<{
      id: string; studio_id: string; campaign_id: string;
      marketing_campaigns: { location_id: string | null } | Array<{ location_id: string | null }> | null;
    }>();
  if (!recipient) return NextResponse.json({ ok: true, ignored: true });
  const campaign = Array.isArray(recipient.marketing_campaigns) ? recipient.marketing_campaigns[0] : recipient.marketing_campaigns;
  const claim = await claimProviderEvent({
    provider: "resend",
    providerEventId: eventId,
    payloadHash: hashProviderPayload(rawBody),
    eventType: event.type,
    studioId: recipient.studio_id,
    locationId: campaign?.location_id ?? null,
    safePayload: { email_id: event.data.email_id, event_type: event.type },
  });
  if (!claim.ok || claim.outcome !== "claimed") {
    const conflict = !claim.ok && (claim.outcome === "payload_conflict" || claim.outcome === "scope_conflict");
    return NextResponse.json({ ok: !conflict, duplicate: !conflict }, { status: conflict ? 409 : 200 });
  }

  try {
    const eventType = event.type.replace(/^email\./, "");
    const { data, error } = await admin.rpc("mkt02_apply_resend_event", {
      p_provider_event_id: eventId,
      p_provider_email_id: event.data.email_id,
      p_event_type: eventType,
      p_occurred_at: event.created_at,
      p_metadata: resendEventMetadata(event),
    });
    if (error || !(data as { ok?: boolean } | null)?.ok) throw error ?? new Error("resend_event_apply_failed");
    const completed = await completeProviderEvent({ recordId: claim.id, claimToken: claim.claimToken, studioId: recipient.studio_id, locationId: campaign?.location_id ?? null });
    if (!completed.ok) throw new Error(`provider_event_complete:${completed.reason}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failProviderEvent({ recordId: claim.id, claimToken: claim.claimToken, errorSummary: message, retryable: true, studioId: recipient.studio_id, locationId: campaign?.location_id ?? null }).catch(() => undefined);
    return NextResponse.json({ error: "event_processing_failed" }, { status: 500 });
  }
}
