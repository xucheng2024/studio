import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestBuyPackagePanel } from "@/components/GuestBuyPackagePanel";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { StudioMediaWarmup } from "@/components/StudioMediaWarmup";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { getCachedPackageShareContext } from "@/lib/cachedSharePages";
import { studioPackagePath } from "@/lib/public-paths";
import { buildPackageShareMetadata } from "@/lib/publicShareOg";
import { getVideoPreview } from "@/lib/videoPreview";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string; packageSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, packageSlug } = await params;
  return buildPackageShareMetadata(studioSlug, packageSlug);
}

export default async function PublicPackageBuyPage({ params }: Props) {
  const { studioSlug: rawStudio, packageSlug: rawPkg } = await params;

  const ctx = await getCachedPackageShareContext(rawStudio ?? "", rawPkg ?? "");
  if (!ctx) notFound();
  const { studio, pkg } = ctx;

  const paymentReady = Boolean((studio as { hitpay_enabled?: boolean | null }).hitpay_enabled);
  const loc = pkg.locations as { name?: string } | { name?: string }[] | null;
  const locName = Array.isArray(loc) ? loc[0]?.name : loc?.name;

  const coverSrc = (pkg as { image_url?: string | null }).image_url ?? null;
  const videoUrl = (pkg as { video_url?: string | null }).video_url ?? null;
  const videoPreview = getVideoPreview(videoUrl ?? "");
  const studioPublicSlug = studio.public_slug ?? rawStudio;
  const pkgSlugPath = (pkg as { share_slug?: string | null }).share_slug ?? rawPkg;
  const packageSharePath = studioPackagePath(studioPublicSlug, pkgSlugPath);
  const warmupMediaUrls = [coverSrc, videoPreview.thumbnailUrl]
    .map((url) => String(url ?? "").trim())
    .filter(Boolean);

  return (
    <main className={ui.page}>
      <StudioMediaWarmup urls={warmupMediaUrls} />
      {/* ── Hero cover (full-bleed within page padding) ── */}
      {videoPreview.embedUrl || (videoUrl && videoUrl.trim()) ? (
        <div className="mb-6">
          <PublicVideoCover
            title={pkg.name}
            coverUrl={coverSrc}
            embedUrl={videoPreview.embedUrl}
            fallbackUrl={videoUrl?.trim() || null}
          />
        </div>
      ) : (
        <ShareCoverImage
          src={coverSrc}
          alt={pkg.name}
          sharePath={packageSharePath}
          shareTitle={pkg.name}
          shareText={`${pkg.name} · ${studio.name} · ${pkg.credits} class passes`}
        />
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <p className={ui.badge}>Shared package</p>
          <h1 className={`${ui.h1} mt-3`}>{pkg.name}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
          {pkg.price != null ? (
            <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              SGD {Number(pkg.price).toFixed(2)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600 dark:text-stone-300">
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              {pkg.credits != null ? `${pkg.credits} class passes` : "Class passes included"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              {pkg.expiry_days != null ? `Expires in ${pkg.expiry_days} days` : "No expiry"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              {pkg.location_id ? (locName ?? "Selected branch") : "All locations"}
            </span>
          </div>
          <p className={`mt-3 text-sm ${paymentReady ? ui.muted : ui.error}`}>
            {paymentReady
              ? "Secure checkout powered by HitPay."
              : "Online payment is not configured for this studio."}
          </p>
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Buy this package</p>
            <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
              {paymentReady ? "Enter your details and continue to payment." : "Online payment is not configured for this studio."}
            </p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              SGD {Number(pkg.price ?? 0).toFixed(2)}
            </p>

            <div className="mt-5">
              <GuestBuyPackagePanel packageId={pkg.id} disabled={!paymentReady} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
