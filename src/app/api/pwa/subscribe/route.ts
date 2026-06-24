import { NextResponse } from "next/server";
import { z } from "zod";
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
  const { error: deleteError } = await admin
    .from("pwa_push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (deleteError) {
    return NextResponse.json({ error: "subscribe_failed" }, { status: 500 });
  }

  const { error } = await admin.from("pwa_push_subscriptions").insert({
    studio_id: studio.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent,
    path_prefix: normalizedPathPrefix,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: "subscribe_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
