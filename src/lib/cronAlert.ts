export async function notifyCronFailure(params: {
  job: string;
  error: string;
}) {
  console.error(`[cron:${params.job}] ${params.error}`);
  const webhook = process.env.CRON_ALERT_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[studio] cron failed: ${params.job}\n${params.error}`,
      }),
    });
  } catch {
    // best effort alerting, do not throw
  }
}
