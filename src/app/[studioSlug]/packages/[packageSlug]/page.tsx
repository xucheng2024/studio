import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestBuyPackagePanel } from "@/components/GuestBuyPackagePanel";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { getCachedPackageShareContext } from "@/lib/cachedSharePages";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { formatPriceOrFree, isZeroAmount } from "@/lib/priceDisplay";
import { studioPackagesPath } from "@/lib/public-paths";
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

  const isFreePackage = isZeroAmount(pkg.price);
  const paymentReady = isFreePackage || Boolean((studio as { hitpay_enabled?: boolean | null }).hitpay_enabled);
  const loc = pkg.locations as { name?: string } | { name?: string }[] | null;
  const locName = Array.isArray(loc) ? loc[0]?.name : loc?.name;

  const packageCurrency = STUDIO_CURRENCY;

  return (
    <main className={ui.page}>
      <div className="mb-4">
        <StudioPublicBackNav href={studioPackagesPath(studio.public_slug)}>Back to packages</StudioPublicBackNav>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <p className={ui.badge}>Package</p>
          <h1 className={`${ui.h1} mt-3`}>{pkg.name}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
          {pkg.price != null ? (
            <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {formatPriceOrFree(packageCurrency, Number(pkg.price))}
              {!isFreePackage ? <span className="ml-2 text-base font-medium text-stone-500 dark:text-stone-400">one-time</span> : null}
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
              ? ""
              : "Online payment is not configured for this studio."}
          </p>
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Buy this package</p>
            <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
              {isFreePackage ? "No payment required. We’ll add it to your account right away." : paymentReady ? "Secure checkout powered by HitPay." : "Online payment is not configured for this studio."}
            </p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {formatPriceOrFree(packageCurrency, Number(pkg.price ?? 0))}
              {!isFreePackage ? <span className="ml-2 text-base font-medium text-stone-500 dark:text-stone-400">one-time</span> : null}
            </p>

            <div className="mt-5">
              <GuestBuyPackagePanel packageId={pkg.id} disabled={!paymentReady} actionLabel={isFreePackage ? "Get package" : "Buy package"} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
