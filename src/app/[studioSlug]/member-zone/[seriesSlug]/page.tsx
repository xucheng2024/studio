import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { MemberZoneUnlockPanel } from "@/components/MemberZoneUnlockPanel";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import {
  isMembershipEnabledAccessType,
  normalizeMemberZoneAccessType,
  resolveMemberZoneAccessRule,
} from "@/lib/memberZoneAccess";
import type { MemberZoneAccessResult } from "@/lib/memberZoneAccess";
import { studioMemberZoneListPath, studioMemberZonePath, studioMembershipPath, studioMePath } from "@/lib/public-paths";
import { buildMemberZoneShareMetadata } from "@/lib/publicShareOg";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";
import { Lock } from "lucide-react";

type Props = { params: Promise<{ studioSlug: string; seriesSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, seriesSlug } = await params;
  return buildMemberZoneShareMetadata(studioSlug, seriesSlug);
}

function renderMedia(url: string, title: string, mediaType: string) {
  const videoPreview = getVideoPreview(url);
  if (mediaType === "audio") {
    if (videoPreview.provider === "mux" && videoPreview.embedUrl) {
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

function accessTypeBadgeLabel(
  accessType: "free" | "paid_only" | "member_only" | "member_or_paid",
  amountLabel?: string,
) {
  if (accessType === "free") return "Free";
  if (accessType === "member_only") return "Members only";
  if (accessType === "paid_only") return amountLabel ?? "Paid";
  return amountLabel ? `From ${amountLabel}` : "Member or paid";
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
  const seriesData = series!;

  const { data: lessonRows } = await admin
    .from("member_zone_lessons")
    .select("id, title, summary, description, media_url, media_type, duration_min, access_override, override_price, currency, sort_order, is_active")
    .eq("series_id", seriesData.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const { data: featuredMembership } = await admin
    .from("membership_products")
    .select("share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .not("share_slug", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sharePath = studioMemberZonePath(studio.public_slug, seriesData.share_slug);
  const membershipHref = featuredMembership?.share_slug
    ? studioMembershipPath(studio.public_slug, featuredMembership.share_slug)
    : studioMePath(studio.public_slug, "memberships");
  const lessons = lessonRows ?? [];
  const seriesPriceLabel = `${String(seriesData.currency ?? "SGD").toUpperCase()} ${Number(seriesData.price ?? 0).toFixed(2)}`;
  const seriesBadge = accessTypeBadgeLabel(
    normalizeMemberZoneAccessType(seriesData.access_type),
    seriesPriceLabel,
  );

  // Batch access resolution: one membership query + one purchases query for all lessons
  let hasMembership = false;
  const paidLessonIds = new Set<string>();
  let hasPaidSeries = false;
  if (user) {
    const [{ data: membershipRows }, { data: purchaseRows }] = await Promise.all([
      admin
        .from("customer_subscriptions")
        .select("status, cancel_at_period_end, current_period_end")
        .eq("studio_id", studio.id)
        .eq("client_id", user.id)
        .in("status", ["scheduled", "active", "retrying", "inactive", "paused"]),
      admin
        .from("member_zone_purchases")
        .select("series_id, lesson_id")
        .eq("studio_id", studio.id)
        .eq("client_id", user.id)
        .eq("status", "paid"),
    ]);
    hasMembership = (membershipRows ?? []).some((row) => isMembershipActiveForAccess(row));
    for (const row of purchaseRows ?? []) {
      if (row.lesson_id) paidLessonIds.add(row.lesson_id);
      if (!row.lesson_id && row.series_id === seriesData.id) hasPaidSeries = true;
    }
  }

  function resolveAccess(lesson: { id: string; access_override: string | null; override_price: number | null; currency: string | null }): MemberZoneAccessResult {
    const { resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope } = resolveMemberZoneAccessRule({
      seriesAccessType: seriesData.access_type,
      seriesPrice: Number(seriesData.price ?? 0),
      seriesCurrency: seriesData.currency ?? "SGD",
      lessonAccessOverride: lesson.access_override,
      lessonOverridePrice: Number(lesson.override_price ?? 0),
      lessonCurrency: lesson.currency ?? "SGD",
    });
    if (resolvedAccessType === "free") {
      return { canPlay: true, reason: "free", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    if (!user) {
      return { canPlay: false, reason: "auth_required", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    if (hasMembership && isMembershipEnabledAccessType(resolvedAccessType)) {
      return { canPlay: true, reason: "membership", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    if (hasPaidSeries || paidLessonIds.has(lesson.id)) {
      return { canPlay: true, reason: "purchased", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    return { canPlay: false, reason: "purchase_required", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
  }

  // Determine if all lessons inherit series access (no per-lesson overrides)
  const allInherit = lessons.every((l) => (l.access_override ?? "inherit") === "inherit");
  const seriesAccessNormalized = normalizeMemberZoneAccessType(seriesData.access_type);
  const firstLessonAccess = lessons.length > 0 ? resolveAccess(lessons[0]) : null;
  const hasLockedLessons = lessons.some((l) => !resolveAccess(l).canPlay);
  const showTopUnlockCard = allInherit && seriesAccessNormalized !== "free" && hasLockedLessons;

  return (
    <main className={ui.page}>
      <div className="mb-4">
        <StudioPublicBackNav href={studioMemberZoneListPath(studio.public_slug)}>Back to member zone</StudioPublicBackNav>
      </div>
      {(() => {
        const promoVideoPreview = getVideoPreview(seriesData.promo_video_url ?? "");
        return promoVideoPreview.embedUrl || seriesData.promo_video_url?.trim() ? (
          <div className="mb-6">
            <PublicVideoCover
              title={seriesData.title}
              coverUrl={seriesData.cover_image_url ?? promoVideoPreview.thumbnailUrl ?? null}
              embedUrl={promoVideoPreview.embedUrl}
              fallbackUrl={seriesData.promo_video_url?.trim() || null}
              priority
            />
          </div>
        ) : (
          <ShareCoverImage
            src={seriesData.cover_image_url}
            alt={seriesData.title}
            sharePath={sharePath}
            shareTitle={seriesData.title}
            shareText={`${seriesData.title} · ${studio.name}`}
          />
        );
      })()}
      <div>
        <p className={ui.badge}>Member zone · {studio.name}</p>
        <h1 className={`${ui.h1} mt-2`}>{seriesData.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={ui.badgeNeutral}>{seriesBadge}</span>
          {lessons.length > 0 ? (
            <span className={ui.badgeNeutral}>{lessons.length} lesson{lessons.length !== 1 ? "s" : ""}</span>
          ) : null}
        </div>
        {seriesData.summary ? <p className={`mt-3 ${ui.lead}`}>{seriesData.summary}</p> : null}
      </div>
      {seriesData.description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
          {seriesData.description}
        </p>
      ) : null}

      <section className="mt-8">
        <div className="flex items-baseline gap-2">
          <h2 className={ui.h2}>Lessons</h2>
          {lessons.length > 0 ? (
            <span className={`text-sm ${ui.muted}`}>{lessons.length} total</span>
          ) : null}
        </div>

        {/* Single top-level unlock card when all lessons share the same rule */}
        {showTopUnlockCard && firstLessonAccess ? (
          <div className="mt-4">
            <MemberZoneUnlockPanel
              studioSlug={studio.public_slug}
              seriesSlug={seriesData.share_slug}
              seriesId={seriesData.id}
              lessonId={null}
              mode={
                firstLessonAccess.resolvedAccessType === "member_only"
                  ? "member_only"
                  : firstLessonAccess.resolvedAccessType === "paid_only"
                    ? "paid_only"
                    : "member_or_paid"
              }
              amountLabel={
                firstLessonAccess.resolvedAccessType === "paid_only" || firstLessonAccess.resolvedAccessType === "member_or_paid"
                  ? `${firstLessonAccess.resolvedCurrency} ${firstLessonAccess.resolvedPrice.toFixed(2)}`
                  : undefined
              }
              isAuthenticated={Boolean(user)}
              membershipHref={membershipHref}
            />
          </div>
        ) : null}
        {lessons.length === 0 ? (
          <div className={`${ui.emptyState} mt-3`}>
            <p className={`text-sm ${ui.muted}`}>No lessons published yet.</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {lessons.map((lesson, idx) => {
                const access = resolveAccess(lesson);
                const amountLabel = `${access.resolvedCurrency} ${access.resolvedPrice.toFixed(2)}`;
                const hasOverride = (lesson.access_override ?? "inherit") !== "inherit";
                const overrideBadge = hasOverride
                  ? accessTypeBadgeLabel(access.resolvedAccessType, amountLabel)
                  : null;
                return (
                  <article key={lesson.id} className={ui.card}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 text-sm tabular-nums text-stone-400 dark:text-stone-500">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                            {lesson.title}
                          </h3>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {lesson.duration_min > 0 ? (
                              <span className={ui.badgeNeutral}>{lesson.duration_min} min</span>
                            ) : null}
                            {access.canPlay ? (
                              <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-600/20 dark:bg-teal-900/30 dark:text-teal-300">
                                Unlocked
                              </span>
                            ) : overrideBadge ? (
                              <span className={ui.badgeNeutral}>{overrideBadge}</span>
                            ) : null}
                          </div>
                        </div>
                        {lesson.summary ? (
                          <p className={`mt-1 text-sm ${ui.muted}`}>{lesson.summary}</p>
                        ) : null}
                        {lesson.description ? (
                          <p className="mt-1.5 whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-400">
                            {lesson.description}
                          </p>
                        ) : null}
                        <div className="mt-3">
                          {access.canPlay ? (
                            renderMedia(lesson.media_url, lesson.title, lesson.media_type ?? "video")
                          ) : showTopUnlockCard ? (
                            <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
                              <Lock size={13} className="shrink-0" />
                              <span>Unlock the series above to watch</span>
                            </div>
                          ) : (
                            <MemberZoneUnlockPanel
                                studioSlug={studio.public_slug}
                                seriesSlug={seriesData.share_slug}
                                seriesId={seriesData.id}
                                lessonId={access.purchaseScope === "lesson" ? lesson.id : null}
                                mode={
                                  access.resolvedAccessType === "member_only"
                                    ? "member_only"
                                    : access.resolvedAccessType === "paid_only"
                                      ? "paid_only"
                                      : "member_or_paid"
                                }
                                amountLabel={
                                  access.resolvedAccessType === "paid_only" || access.resolvedAccessType === "member_or_paid"
                                    ? amountLabel
                                    : undefined
                                }
                                isAuthenticated={Boolean(user)}
                                membershipHref={membershipHref}
                              />
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
