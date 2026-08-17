import { createAdminClient } from "@/lib/supabase/admin";

export type StudioResendSecrets = {
  apiKey: string;
  fromEmail: string;
  webhookSecret: string;
};

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function studioResendWebhookPath(studioId: string) {
  return `/api/webhooks/resend/${studioId}`;
}

export async function getStudioResendSecrets(studioId: string): Promise<StudioResendSecrets | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studio_email_secrets")
    .select("resend_api_key, resend_from_email, resend_webhook_secret")
    .eq("studio_id", studioId)
    .maybeSingle<{
      resend_api_key: string | null;
      resend_from_email: string | null;
      resend_webhook_secret: string | null;
    }>();
  if (error) throw error;
  const apiKey = trimOrNull(data?.resend_api_key);
  const fromEmail = trimOrNull(data?.resend_from_email);
  const webhookSecret = trimOrNull(data?.resend_webhook_secret);
  if (!apiKey || !fromEmail || !webhookSecret) return null;
  return { apiKey, fromEmail, webhookSecret };
}

export async function getStudioResendSendConfig(studioId: string): Promise<StudioResendSecrets | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studios")
    .select("resend_enabled")
    .eq("id", studioId)
    .maybeSingle<{ resend_enabled: boolean | null }>();
  if (error) throw error;
  if (!data?.resend_enabled) return null;
  return getStudioResendSecrets(studioId);
}
