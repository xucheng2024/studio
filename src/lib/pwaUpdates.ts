import { createAdminClient } from "@/lib/supabase/admin";
import { sendWebPush } from "@/lib/webPush";

export type UpdateSection = "classes" | "events" | "packages" | "member-zone";

const SECTION_LABEL: Record<UpdateSection, string> = {
  classes: "classes",
  events: "events",
  packages: "packages",
  "member-zone": "member zone",
};

export async function recordStudioContentUpdate(studioId: string, section: UpdateSection) {
  const admin = createAdminClient();
  await admin
    .from("studio_content_updates")
    .upsert(
      {
        studio_id: studioId,
        section,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "studio_id,section" },
    );

  // Fire-and-forget push fanout so publish/save UX stays snappy.
  // We intentionally do not await this network-heavy work.
  void fanoutStudioPush(studioId, section);
}

async function fanoutStudioPush(studioId: string, section: UpdateSection) {
  const admin = createAdminClient();

  const [{ data: studio }, { data: subscriptions }] = await Promise.all([
    admin.from("studios").select("public_slug, name").eq("id", studioId).maybeSingle(),
    admin
      .from("pwa_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("studio_id", studioId),
  ]);

  if (!studio?.public_slug || !subscriptions?.length) return;

  const title = studio.name ?? "Studio";
  const body = `New ${SECTION_LABEL[section]} update available.`;
  const url = `/${studio.public_slug}#${section === "member-zone" ? "member-zone" : section}`;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendWebPush(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        {
          title,
          body,
          url,
          tag: `${studioId}:${section}`,
          badge: "/favicon.ico",
          icon: "/favicon.ico",
        },
      );
      if (
        !result.ok &&
        result.reason === "send_failed" &&
        (result.statusCode === 404 || result.statusCode === 410)
      ) {
        // Clean up only invalid/expired subscriptions.
        // Other failures are transient and should be retried later.
        await admin.from("pwa_push_subscriptions").delete().eq("id", sub.id);
      }
    }),
  );
}

export async function getStudioSectionUpdates(studioSlug: string) {
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio) return null;

  const { data: rows } = await admin
    .from("studio_content_updates")
    .select("section, updated_at")
    .eq("studio_id", studio.id);

  const updates: Partial<Record<UpdateSection, string>> = {};
  for (const row of rows ?? []) {
    updates[row.section as UpdateSection] = String(row.updated_at);
  }
  return { studioId: studio.id, updates };
}
