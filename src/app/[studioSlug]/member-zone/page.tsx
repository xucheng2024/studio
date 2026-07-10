import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioMemberZoneListPath, studioMemberZonePath } from "@/lib/public-paths";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Member zone",
    description: "Explore exclusive member-only and paid lesson series.",
    path: studioMemberZoneListPath(studioSlug),
  });
}


export default async function PublicMemberZonePage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: seriesRows } = await admin
    .from("member_zone_series")
    .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, share_slug, sort_order")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#member-zone`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4 max-w-2xl">
        <h1 className={ui.h1}>Member zone</h1>
        <p className={`mt-1 ${ui.muted}`}>Exclusive audio &amp; video lesson series for members.</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {(seriesRows ?? []).map((series) => {
          const href = studioMemberZonePath(studio.public_slug, series.share_slug);
          const hasPrice = series.price != null && Number(series.price) > 0;
          const priceStr = hasPrice ? `${STUDIO_CURRENCY} ${Number(series.price).toFixed(2)}` : null;
          const accessTag =
            series.access_type === "free"
              ? { label: "Free", color: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-900/30 dark:text-teal-300" }
              : series.access_type === "paid_only"
                ? { label: priceStr ?? "Paid", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" }
                : series.access_type === "member_or_paid"
                  ? { label: priceStr ? `From ${priceStr}` : "Member or paid", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" }
                  : { label: "Members only", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" };
          const ctaLabel = "View series";
          const preview = getVideoPreview(series.promo_video_url ?? "");
          const cover = series.cover_image_url ?? preview.thumbnailUrl ?? null;
          return (
            <article key={series.id} className={`${ui.card} flex flex-col`}>
              <Link href={href} className="block shrink-0">
                {cover ? (
                  <Image src={cover} alt={series.title} width={1200} height={675} className="aspect-video w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800" />
                ) : (
                  <div className="aspect-video w-full rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                )}
              </Link>
              <div className="mt-3 flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                    <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">{series.title}</Link>
                  </h2>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${accessTag.color}`}>{accessTag.label}</span>
                </div>
                {series.summary ? <p className={`mt-1.5 line-clamp-2 text-sm ${ui.muted}`}>{series.summary}</p> : null}
                <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={href} className={`${ui.btnPrimarySm} w-full sm:w-auto`}>{ctaLabel}</Link>
                  <SessionShareLinkButton sharePath={href} title={`${series.title} · ${studio.name}`} text={`Check out this member zone series: ${series.title}`} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!seriesRows?.length ? (
        <div className={`mt-6 ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No member zone series available right now.</p>
        </div>
      ) : null}
    </main>
  );
}
