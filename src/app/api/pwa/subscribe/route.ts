import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, getRequestIpAddress } from "@/lib/apiRateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeStudioSlug } from "@/lib/slug";

const BodySchema = z.object({
  studioSlug: z.string().min(1),
  pathPrefix: z.string(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(8),
      auth: z.string().min(8),
    }),
  }),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const studioSlug = normalizeStudioSlug(parsed.data.studioSlug);
  if (!studioSlug) {
    return NextResponse.json({ error: "invalid_studio_slug" }, { status: 400 });
  }

  const rateLimit = await consumeApiRateLimit({
    action: "pwa_subscribe",
    scope: `${studioSlug}|${getRequestIpAddress(req)}`,
    limit: 12,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }

  const { endpoint, keys } = parsed.data.subscription;
  const normalizedPathPrefix =
    parsed.data.pathPrefix && parsed.data.pathPrefix.startsWith("/") && !parsed.data.pathPrefix.includes("://")
      ? parsed.data.pathPrefix.replace(/\/+$/, "")
      : "";
  const userAgent = req.headers.get("user-agent");
  const { error } = await admin.from("pwa_push_subscriptions").upsert(
    {
      studio_id: studio.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent,
      path_prefix: normalizedPathPrefix,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "studio_id,endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: "subscribe_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
