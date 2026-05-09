import webpush from "web-push";

let configured = false;
let disabled = false;

function ensureConfigured() {
  if (configured || disabled) return;
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT ?? "mailto:support@example.com";
  if (!publicKey || !privateKey) {
    disabled = true;
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export function getWebPushPublicKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY ?? "";
}

export async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: Record<string, unknown>,
) {
  ensureConfigured();
  if (!configured) return { ok: false as const, reason: "not_configured" as const };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true as const };
  } catch (error: unknown) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode ?? 0)
        : 0;
    return { ok: false as const, reason: "send_failed" as const, statusCode, error };
  }
}
