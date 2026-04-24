import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { getCachedPackageShareContext } from "@/lib/cachedSharePages";
import { getPaynowSummary } from "@/lib/paynow";
import { buildPackageShareMetadata } from "@/lib/publicShareOg";
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

  const paynow = getPaynowSummary({
    paynow_enabled: Boolean(studio.paynow_enabled),
    paynow_proxy_type: studio.paynow_proxy_type ?? null,
    paynow_uen: studio.paynow_uen ?? null,
    paynow_mobile: studio.paynow_mobile ?? null,
    paynow_payee_name: studio.paynow_payee_name ?? null,
  });
  const loc = pkg.locations as { name?: string } | { name?: string }[] | null;
  const locName = Array.isArray(loc) ? loc[0]?.name : loc?.name;

  const coverSrc = (pkg as { image_url?: string | null }).image_url ?? null;

  return (
    <main className={ui.page}>
      {/* ── Hero cover (full-bleed within page padding) ── */}
      <ShareCoverImage src={coverSrc} alt={pkg.name} />

      <div className="max-w-2xl">
        <p className={ui.badge}>Shared package</p>
        <h1 className={`${ui.h1} mt-3`}>{pkg.name}</h1>
        <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
        <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
          SGD {Number(pkg.price ?? 0).toFixed(2)}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600 dark:text-stone-300">
          <span className="flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
            {pkg.credits} credits
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
        <p className={`mt-3 text-sm ${paynow.configured ? ui.muted : ui.error}`}>{paynow.line}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <p className={`text-sm ${ui.muted}`}>
            Package purchase is temporarily unavailable on this public page.
          </p>
          <Link href={`/booking/${studio.public_slug}`} className={ui.btnSecondary}>
            Browse classes
          </Link>
        </div>
      </div>
    </main>
  );
}
