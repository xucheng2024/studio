import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { CoverLocationCornerBadge, SessionDateMiniCalendar, sessionLocationLabel } from "@/components/SessionDateMiniCalendar";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { studioClassPath, studioClassesPath, studioHomePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Classes",
    description: "Browse upcoming classes, availability, and booking details.",
    path: studioClassesPath(studioSlug),
  });
}

export default async function StudioBookingPage({ params }: Props) {
  const { studioSlug: raw } = await params;
  const slug = normalizeStudioSlug(raw);
  if (!slug) notFound();

  const supabase = createAdminClient();
  const studioRes = await supabase
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", slug)
    .maybeSingle();
  const { data: studio, error: stErr } = studioRes;
  if (stErr || !studio || studio.contract_status === "suspended") notFound();

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `id, location_id, start_time, spots_left, capacity, guest_price, credits_required,
       class_title_snapshot, class_image_url_snapshot, class_video_url_snapshot,
       locations ( name ),
       classes!inner ( title, studio_id, image_url, video_url, capacity, is_active, share_slug )`,
    )
    .eq("classes.studio_id", studio.id)
    .eq("classes.is_active", true)
    .eq("status", "scheduled")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  const firstLocationId = (sessions?.[0] as { location_id?: string } | undefined)?.location_id ?? null;
  const rulesQuery = supabase
    .from("booking_rules")
    .select("cancel_cutoff_hours, late_cancel_deduct_credit, no_show_deduct_credit, no_show_buffer_min")
    .eq("studio_id", studio.id)
    .limit(1);
  const { data: rules } = firstLocationId
    ? await rulesQuery.eq("location_id", firstLocationId).maybeSingle()
    : await rulesQuery.is("location_id", null).maybeSingle();

  return (
    <main className={ui.page}>
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#upcoming-classes`}>
        Back to studio
      </StudioPublicBackNav>
      {/* ── Studio header ── */}
      <header className="mb-8 mt-4 max-w-2xl">
        <p className={ui.badge}>{studio.name}</p>
        <h1 className={`${ui.h1} mt-3`}>Book a class</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Pick a session to open its page and complete booking or checkout.
        </p>

        {/* Policy summary */}
        {rules ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>
            Free cancellation ≥{rules.cancel_cutoff_hours ?? 12}h before class ·
            Late cancel {rules.late_cancel_deduct_credit ? "uses" : "does not use"} a class pass ·
            No-show after {rules.no_show_buffer_min ?? 15} min {rules.no_show_deduct_credit ? "uses" : "does not use"} a class pass
          </p>
        ) : null}

      </header>

      {/* ── Session list ── */}
      <ul className="flex flex-col gap-4 max-w-2xl">
        {(sessions ?? []).map((s) => {
          const classRow = s.classes as
            | { title?: string; studio_id?: string; image_url?: string | null; video_url?: string | null; capacity?: number | null }
            | { title?: string; studio_id?: string; image_url?: string | null; video_url?: string | null; capacity?: number | null }[]
            | null;
          const cls = Array.isArray(classRow) ? classRow[0] : classRow;
          const classShareSlug = String((cls as { share_slug?: string | null } | undefined)?.share_slug ?? "")
            .trim()
            .toLowerCase();
          const canLinkToClass =
            classShareSlug.length >= 6 &&
            classShareSlug.length <= 80 &&
            /^[a-z0-9-]+$/.test(classShareSlug);
          const studioPublicSlug = String(studio.public_slug ?? slug);
          const detailHref = canLinkToClass
            ? studioClassPath(studioPublicSlug, classShareSlug, `session_id=${s.id}`)
            : null;
          const title = (s as { class_title_snapshot?: string | null }).class_title_snapshot ?? cls?.title ?? "Class";
          const imageUrl = (s as { class_image_url_snapshot?: string | null }).class_image_url_snapshot ?? cls?.image_url ?? null;
          const videoUrl = (s as { class_video_url_snapshot?: string | null }).class_video_url_snapshot ?? cls?.video_url ?? null;
          const videoPreview = getVideoPreview(videoUrl ?? "");
          const coverUrl = imageUrl ?? videoPreview.thumbnailUrl ?? null;
          const showVideoCover = Boolean(videoPreview.embedUrl || videoUrl?.trim());
          const sessionCapacity = Number((s as { capacity?: number | null }).capacity ?? cls?.capacity ?? 0) || 0;
          const dt = new Date(s.start_time);
          const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
          const weekday = dt.toLocaleDateString("en-SG", { weekday: "short", timeZone: "Asia/Singapore" });
          const dayNum = dt.getDate();
          const month = dt.toLocaleDateString("en-SG", { month: "short", timeZone: "Asia/Singapore" });
          const creditsRequired = Number(s.credits_required ?? 1);
          const spotsLeft = Number(s.spots_left ?? 0);
          const spotsLow = spotsLeft > 0 && spotsLeft <= 3;
          const spotsText = spotsLeft === 0
            ? sessionCapacity > 0 ? `Full · 0 / ${sessionCapacity}` : "Full"
            : sessionCapacity > 0
              ? `${spotsLeft} / ${sessionCapacity} left`
              : spotsLow ? `${spotsLeft} left` : `${spotsLeft} spots`;
          const locationName = sessionLocationLabel(s as { locations?: { name?: string | null } | { name?: string | null }[] | null });

          return (
            <li key={s.id} className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white/95 shadow-sm dark:border-stone-800/90 dark:bg-stone-900/70">
              {/* Cover image / video / placeholder */}
              <div className="relative">
                {showVideoCover ? (
                  <PublicVideoCover
                    title={title}
                    coverUrl={coverUrl}
                    embedUrl={videoPreview.embedUrl}
                    fallbackUrl={videoUrl?.trim() || null}
                    locationLabel={locationName}
                  />
                ) : coverUrl ? (
                  <>
                    <Image
                      src={coverUrl}
                      alt={title}
                      width={1200}
                      height={675}
                      className="aspect-video w-full object-cover"
                      sizes="(max-width: 640px) 100vw, 672px"
                    />
                    <CoverLocationCornerBadge name={locationName} />
                  </>
                ) : (
                  <>
                    <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900" />
                    <CoverLocationCornerBadge name={locationName} />
                  </>
                )}
                <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${
                  spotsLeft === 0
                    ? "bg-red-600/85 text-white"
                    : spotsLow
                      ? "bg-amber-500/85 text-white"
                      : "bg-teal-600/85 text-white"
                }`}>
                  {spotsText}
                </span>
              </div>

              <div className="p-4">
                {/* Date + info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <SessionDateMiniCalendar
                      variant="compact"
                      weekdayLabel={weekday}
                      dayOfMonth={dayNum}
                      monthLabel={month}
                    />
                    {/* Title + time + price */}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-stone-900 dark:text-stone-50">{title}</p>
                      <p className="mt-0.5 text-sm font-medium text-stone-700 dark:text-stone-300">{timeLabel}</p>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        {s.guest_price != null && Number(s.guest_price) > 0 ? (
                          <span className="text-base font-bold tabular-nums text-teal-700 dark:text-teal-300">
                            ${Number(s.guest_price).toFixed(2)}
                          </span>
                        ) : null}
                        {s.guest_price != null && Number(s.guest_price) > 0 ? (
                          <span className="text-xs text-stone-500 dark:text-stone-400">/ session</span>
                        ) : null}
                        {s.guest_price != null && Number(s.guest_price) > 0 && creditsRequired > 0 ? (
                          <span className="text-xs text-stone-400 dark:text-stone-500">or</span>
                        ) : null}
                        {creditsRequired > 0 ? (
                          <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                            {creditsRequired} class pass{creditsRequired !== 1 ? "es" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {/* intentionally empty — spots badge is shown on the cover */}
                </div>

                {/* Actions — booking only on class detail page */}
                <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                  {detailHref ? (
                    <Link
                      href={detailHref}
                      className={`${ui.btnPrimary} flex w-full justify-center no-underline`}
                    >
                      Book now
                    </Link>
                  ) : (
                    <p className={`text-sm ${ui.muted}`}>
                      This class does not have a public link yet. Ask the studio to publish it in the dashboard.
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!sessions?.length ? (
        <div className={`mt-6 max-w-2xl ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No upcoming sessions yet. Check back soon.</p>
        </div>
      ) : null}
    </main>
  );
}
