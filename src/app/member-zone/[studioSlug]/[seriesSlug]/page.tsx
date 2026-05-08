import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { MemberZoneUnlockPanel } from "@/components/MemberZoneUnlockPanel";
import { Lock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import { resolveMemberZoneAccessRule } from "@/lib/memberZoneAccess";
import type { MemberZoneAccessResult } from "@/lib/memberZoneAccess";
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
  if (accessType === "free") return "Free";
  if (accessType === "members_only") return "Members only";
  return amountLabel ? `Paid · ${amountLabel}` : "Paid";
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
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

  const sharePath = `/member-zone/${studio.public_slug}/${seriesData.share_slug}`;
  const membershipHref = featuredMembership?.share_slug
    ? `/membership/${studio.public_slug}/${featuredMembership.share_slug}`
    : "/me/memberships";
  const lessons = lessonRows ?? [];
  const seriesPriceLabel = `${String(seriesData.currency ?? "SGD").toUpperCase()} ${Number(seriesData.price ?? 0).toFixed(2)}`;
  const seriesBadge = accessTypeBadgeLabel(
    (String(seriesData.access_type ?? "members_only").toLowerCase() as "free" | "paid" | "members_only"),
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
    if (hasMembership) {
      return { canPlay: true, reason: "membership", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    if (hasPaidSeries || paidLessonIds.has(lesson.id)) {
      return { canPlay: true, reason: "purchased", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
    }
    return { canPlay: false, reason: "purchase_required", resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
  }

  return (
    <main className={ui.page}>
      <ShareCoverImage
        src={seriesData.cover_image_url}
        alt={seriesData.title}
        sharePath={sharePath}
        shareTitle={seriesData.title}
        shareText={`${seriesData.title} · ${studio.name}`}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={ui.badge}>Member zone</p>
          <h1 className={`${ui.h1} mt-3`}>{seriesData.title}</h1>
          <div className="mt-2">
            <span className={ui.badgeNeutral}>{seriesBadge}</span>
          </div>
          {seriesData.summary ? <p className={`mt-2 ${ui.lead}`}>{seriesData.summary}</p> : null}
        </div>
        <SessionShareLinkButton
          sharePath={sharePath}
          title={`${seriesData.title} · ${studio.name}`}
          text={`Check out this member zone series: ${seriesData.title}`}
        />
      </div>
      {seriesData.description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
          {seriesData.description}
        </p>
      ) : null}

      {seriesData.promo_video_url ? (
        <div className={`${ui.card} mt-6`}>{renderMedia(seriesData.promo_video_url, `${seriesData.title} intro`, "video")}</div>
      ) : null}

      <section className="mt-8">
        <h2 className={ui.h2}>Lessons</h2>
        {lessons.length === 0 ? (
          <div className={`${ui.emptyState} mt-3`}>
            <p className={`text-sm ${ui.muted}`}>No lessons published yet.</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4">
            {lessons.map((lesson) => {
                const access = resolveAccess(lesson);
                const amountLabel = `${access.resolvedCurrency} ${access.resolvedPrice.toFixed(2)}`;
                const lessonBadge = accessTypeBadgeLabel(access.resolvedAccessType, amountLabel);
                const accessHint =
                  (lesson.access_override ?? "inherit") === "inherit"
                    ? `Inherits series access (${seriesBadge})`
                    : `Lesson override (${lessonBadge})`;
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
                              Locked
                            </div>
                            <MemberZoneUnlockPanel
                              studioSlug={studio.public_slug}
                              seriesSlug={seriesData.share_slug}
                              seriesId={seriesData.id}
                              lessonId={access.purchaseScope === "lesson" ? lesson.id : null}
                              mode={access.resolvedAccessType === "members_only" ? "membership_only" : "purchase"}
                              amountLabel={access.resolvedAccessType === "paid" ? amountLabel : undefined}
                              isAuthenticated={Boolean(user)}
                              membershipHref={membershipHref}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
            })}
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
