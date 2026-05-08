import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { MemberZoneUnlockPanel } from "@/components/MemberZoneUnlockPanel";
import { Lock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMemberZonePlaybackAccess } from "@/lib/memberZoneAccess";
import { buildMemberZoneShareMetadata } from "@/lib/publicShareOg";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string; seriesSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, seriesSlug } = await params;
  return buildMemberZoneShareMetadata(studioSlug, seriesSlug);
}

function renderMedia(url: string, title: string, mediaType: string) {
  const videoPreview = getVideoPreview(url);
  if (mediaType === "audio") {
    return (
      <audio controls className="w-full">
        <source src={url} />
      </audio>
    );
  }
  if (videoPreview.embedUrl) {
    return (
      <iframe
        src={videoPreview.embedUrl}
        title={title}
        className="aspect-video w-full rounded-lg"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }
  return (
    <video controls className="aspect-video w-full rounded-lg bg-black">
      <source src={url} />
    </video>
  );
}

function accessTypeBadgeLabel(accessType: "free" | "paid" | "members_only", amountLabel?: string) {
  if (accessType === "free") return "免费";
  if (accessType === "members_only") return "会员";
  return amountLabel ? `付费 ${amountLabel}` : "付费";
}

export default async function MemberZoneSeriesPage({ params }: Props) {
  const { studioSlug, seriesSlug } = await params;
  const admin = createAdminClient();

  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: series } = await admin
    .from("member_zone_series")
    .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, currency, share_slug, is_active")
    .eq("studio_id", studio.id)
    .eq("share_slug", seriesSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!series) notFound();

  const { data: lessonRows } = await admin
    .from("member_zone_lessons")
    .select("id, title, summary, description, media_url, media_type, duration_min, access_override, override_price, currency, sort_order, is_active")
    .eq("series_id", series.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sharePath = `/member-zone/${studio.public_slug}/${series.share_slug}`;
  const lessons = lessonRows ?? [];
  const seriesPriceLabel = `${String(series.currency ?? "SGD").toUpperCase()} ${Number(series.price ?? 0).toFixed(2)}`;
  const seriesBadge = accessTypeBadgeLabel(
    (String(series.access_type ?? "members_only").toLowerCase() as "free" | "paid" | "members_only"),
    seriesPriceLabel,
  );

  return (
    <main className={ui.page}>
      <ShareCoverImage
        src={series.cover_image_url}
        alt={series.title}
        sharePath={sharePath}
        shareTitle={series.title}
        shareText={`${series.title} · ${studio.name}`}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={ui.badge}>Member zone</p>
          <h1 className={`${ui.h1} mt-3`}>{series.title}</h1>
          <div className="mt-2">
            <span className={ui.badgeNeutral}>{seriesBadge}</span>
          </div>
          {series.summary ? <p className={`mt-2 ${ui.lead}`}>{series.summary}</p> : null}
        </div>
        <SessionShareLinkButton
          sharePath={sharePath}
          title={`${series.title} · ${studio.name}`}
          text={`Check out this member zone series: ${series.title}`}
        />
      </div>
      {series.description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
          {series.description}
        </p>
      ) : null}

      {series.promo_video_url ? (
        <div className={`${ui.card} mt-6`}>{renderMedia(series.promo_video_url, `${series.title} intro`, "video")}</div>
      ) : null}

      <section className="mt-8">
        <h2 className={ui.h2}>Lessons</h2>
        {lessons.length === 0 ? (
          <div className={`${ui.emptyState} mt-3`}>
            <p className={`text-sm ${ui.muted}`}>No lessons published yet.</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4">
            {await Promise.all(
              lessons.map(async (lesson) => {
                const access = await resolveMemberZonePlaybackAccess(admin, {
                  userId: user?.id ?? null,
                  studioId: studio.id,
                  seriesId: series.id,
                  lessonId: lesson.id,
                  seriesAccessType: series.access_type,
                  seriesPrice: Number(series.price ?? 0),
                  seriesCurrency: series.currency ?? "SGD",
                  lessonAccessOverride: lesson.access_override,
                  lessonOverridePrice: Number(lesson.override_price ?? 0),
                  lessonCurrency: lesson.currency ?? "SGD",
                });
                const amountLabel = `${access.resolvedCurrency} ${access.resolvedPrice.toFixed(2)}`;
                const lessonBadge = accessTypeBadgeLabel(access.resolvedAccessType, amountLabel);
                const accessHint =
                  (lesson.access_override ?? "inherit") === "inherit"
                    ? `继承系列规则（${seriesBadge}）`
                    : `本节课规则（${lessonBadge}）`;
                return (
                  <article key={lesson.id} className={ui.card}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                        {lesson.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={ui.badgeNeutral}>
                          {lesson.duration_min > 0 ? `${lesson.duration_min} min` : "Flexible length"}
                        </span>
                        <span className={ui.badgeNeutral}>{lessonBadge}</span>
                      </div>
                    </div>
                    {lesson.summary ? <p className={`mt-1 text-sm ${ui.muted}`}>{lesson.summary}</p> : null}
                    <p className={`mt-1 text-xs ${ui.muted}`}>{accessHint}</p>
                    {lesson.description ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
                        {lesson.description}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      {access.canPlay ? (
                        renderMedia(lesson.media_url, lesson.title, lesson.media_type ?? "video")
                      ) : (
                        <div className="relative overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                          <div className="pointer-events-none absolute inset-0 bg-white/60 backdrop-blur-[1px] dark:bg-stone-900/55" />
                          <div className="relative z-10 p-3">
                            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900/80 px-2.5 py-1 text-xs font-medium text-white dark:bg-stone-100/85 dark:text-stone-900">
                              <Lock size={12} />
                              已锁定内容
                            </div>
                            <MemberZoneUnlockPanel
                              studioSlug={studio.public_slug}
                              seriesSlug={series.share_slug}
                              seriesId={series.id}
                              lessonId={access.purchaseScope === "lesson" ? lesson.id : null}
                              mode={access.resolvedAccessType === "members_only" ? "membership_only" : "purchase"}
                              amountLabel={access.resolvedAccessType === "paid" ? amountLabel : undefined}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }),
            )}
          </div>
        )}
      </section>

      <div className="mt-6">
        <Link href={`/${studio.public_slug}`} className={ui.btnSecondarySm}>
          Back to studio page
        </Link>
      </div>
    </main>
  );
}
