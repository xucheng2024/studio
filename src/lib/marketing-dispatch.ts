import "server-only";

import { Resend, type WebhookEventPayload } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudioResendSendConfig } from "@/lib/studio-email";

type DispatchRow = {
  recipient_id: string;
  campaign_id: string;
  studio_id: string;
  location_id: string | null;
  email_snapshot: string;
  full_name_snapshot: string | null;
  unsubscribe_token: string;
  claim_token: string;
  dispatch_batch_id: string;
  attempt_count: number;
  subject: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  click_token: string | null;
  studio_name: string;
};

function escHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function appBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured?.startsWith("https://") || configured?.startsWith("http://localhost:")) return configured;
  const vercelHost = process.env.VERCEL_URL?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return vercelHost ? `https://${vercelHost}` : "";
}

function buildCampaignEmail(row: DispatchRow, baseUrl: string, fromEmail: string) {
  const unsubscribeUrl = `${baseUrl}/api/marketing/unsubscribe?token=${row.unsubscribe_token}`;
  const clickUrl = row.cta_label && row.click_token ? `${baseUrl}/r/c/${row.click_token}` : null;
  const greeting = row.full_name_snapshot?.trim() ? `Hi ${row.full_name_snapshot.trim()},` : "Hi,";
  const image = row.image_url
    ? `<p><img src="${escHtml(row.image_url)}" alt="" style="max-width:100%;height:auto" /></p>`
    : "";
  const cta = clickUrl && row.cta_label
    ? `<p><a href="${escHtml(clickUrl)}" style="display:inline-block;padding:12px 18px;background:#1c1917;color:#fff;text-decoration:none;border-radius:8px">${escHtml(row.cta_label)}</a></p>`
    : "";
  return {
    from: fromEmail,
    to: [row.email_snapshot],
    subject: row.subject,
    text: `${greeting}\n\n${row.body}${clickUrl && row.cta_label ? `\n\n${row.cta_label}: ${clickUrl}` : ""}\n\nUnsubscribe: ${unsubscribeUrl}`,
    html: `<p>${escHtml(greeting)}</p><p>${escHtml(row.body).replaceAll("\n", "<br />")}</p>${image}${cta}<p><small>${escHtml(row.studio_name)} · <a href="${escHtml(unsubscribeUrl)}">Unsubscribe</a></small></p>`,
    tags: [
      { name: "campaign_id", value: row.campaign_id },
      { name: "recipient_id", value: row.recipient_id },
    ],
  };
}

function isRetryableProviderError(statusCode: number | null) {
  return statusCode === null || statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

async function failDispatchBatch(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    recipientIds: string[];
    claimToken: string;
    errorSummary: string;
    retryable: boolean;
  },
) {
  const { data, error } = await admin.rpc("mkt02_fail_dispatch_batch", {
    p_recipient_ids: params.recipientIds,
    p_claim_token: params.claimToken,
    p_error_summary: params.errorSummary,
    p_retryable: params.retryable,
    p_max_attempts: 5,
  });
  if (error) throw error;
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error("dispatch_failure_update_rejected");
}

export async function processMarketingCampaignBatch(batchSize = 50) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mkt02_claim_dispatch_batch", {
    p_batch_size: Math.max(1, Math.min(100, Math.trunc(batchSize))),
    p_stale_after_seconds: 300,
    p_max_attempts: 5,
  });
  if (error) throw error;
  const rows = (data ?? []) as DispatchRow[];
  if (!rows.length) return { claimed: 0, submitted: 0, retrying: 0, failed: 0 };

  const recipientIds = rows.map((row) => row.recipient_id);
  const claimToken = rows[0].claim_token;
  const studioId = rows[0].studio_id;
  const baseUrl = appBaseUrl();
  const config = await getStudioResendSendConfig(studioId);
  if (!config || !baseUrl) {
    const missing = [!config && "studio_resend", !baseUrl && "NEXT_PUBLIC_APP_URL"].filter(Boolean).join(",");
    await failDispatchBatch(admin, {
      recipientIds,
      claimToken,
      errorSummary: `email_provider_not_configured:${missing}`,
      retryable: false,
    });
    return { claimed: rows.length, submitted: 0, retrying: 0, failed: rows.length };
  }

  try {
    const resend = new Resend(config.apiKey);
    const response = await resend.batch.send(
      rows.map((row) => buildCampaignEmail(row, baseUrl, config.fromEmail)),
      { idempotencyKey: `mkt02/${rows[0].dispatch_batch_id}` },
    );
    if (response.error || !response.data) {
      const retryable = isRetryableProviderError(response.error?.statusCode ?? null);
      await failDispatchBatch(admin, {
        recipientIds,
        claimToken,
        errorSummary: response.error?.message ?? "resend_batch_failed",
        retryable,
      });
      return { claimed: rows.length, submitted: 0, retrying: retryable ? rows.length : 0, failed: retryable ? 0 : rows.length };
    }
    const providerIds = response.data.data.map((item) => item.id);
    const { data: completed, error: completeError } = await admin.rpc("mkt02_complete_dispatch_batch", {
      p_recipient_ids: recipientIds,
      p_provider_email_ids: providerIds,
      p_claim_token: claimToken,
    });
    if (completeError) throw completeError;
    if (!(completed as { ok?: boolean } | null)?.ok) throw new Error("dispatch_completion_rejected");
    return { claimed: rows.length, submitted: rows.length, retrying: 0, failed: 0 };
  } catch (error) {
    // Leave processing rows claimed when provider acceptance is uncertain. A stale
    // reclaim replays the exact batch with the same Resend idempotency key.
    console.error("[marketing-dispatch] uncertain batch outcome", error);
    return { claimed: rows.length, submitted: 0, retrying: rows.length, failed: 0 };
  }
}

export function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  config: { apiKey: string; webhookSecret: string },
): WebhookEventPayload {
  const secret = config.webhookSecret.trim();
  if (!secret) throw new Error("resend_webhook_not_configured");
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) throw new Error("missing_resend_webhook_headers");
  return new Resend(config.apiKey).webhooks.verify({
    payload: rawBody,
    headers: { id, timestamp, signature },
    webhookSecret: secret,
  });
}

export function resendEventMetadata(event: WebhookEventPayload): Record<string, unknown> {
  if (event.type === "email.failed") return { reason: event.data.failed.reason };
  if (event.type === "email.bounced") return { reason: event.data.bounce.message, bounce_type: event.data.bounce.type, bounce_subtype: event.data.bounce.subType };
  if (event.type === "email.suppressed") return { reason: event.data.suppressed.message, suppression_type: event.data.suppressed.type };
  if (event.type === "email.clicked") return { link: event.data.click.link };
  return {};
}
