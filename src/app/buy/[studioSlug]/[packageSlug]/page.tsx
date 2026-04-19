import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyPackageButton } from "@/components/BuyButtons";
import { GuestBuyPackagePanel } from "@/components/GuestBuyPackagePanel";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { getPaynowSummary } from "@/lib/paynow";
import { buildPackageShareMetadata } from "@/lib/publicShareOg";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ studioSlug: string; packageSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, packageSlug } = await params;
  return buildPackageShareMetadata(studioSlug, packageSlug);
}

export default async function PublicPackageBuyPage({ params }: Props) {
  const { studioSlug: rawStudio, packageSlug: rawPkg } = await params;
  const studioSlug = normalizeStudioSlug(rawStudio ?? "");
  const pkgSlug = String(rawPkg ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(pkgSlug)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: studio } = await supabase
    .from("studios")
    .select(
      "id, name, public_slug, contract_status, paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name",
    )
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: pkg } = await supabase
    .from("packages")
    .select("id, name, credits, price, expiry_days, location_id, is_active, image_url, locations ( name )")
    .eq("studio_id", studio.id)
    .eq("share_slug", pkgSlug)
    .maybeSingle();
  if (!pkg || pkg.is_active === false) notFound();

  const paynow = getPaynowSummary({
    paynow_enabled: Boolean(studio.paynow_enabled),
    paynow_proxy_type: studio.paynow_proxy_type ?? null,
    paynow_uen: studio.paynow_uen ?? null,
    paynow_mobile: studio.paynow_mobile ?? null,
    paynow_payee_name: studio.paynow_payee_name ?? null,
  });
  const loc = pkg.locations as { name?: string } | { name?: string }[] | null;
  const locName = Array.isArray(loc) ? loc[0]?.name : loc?.name;
  const signInNext = `/buy/${studioSlug}/${pkgSlug}`;

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
          {user ? (
            <BuyPackageButton packageId={pkg.id} disabled={!paynow.configured} />
          ) : (
            <div className="flex max-w-md flex-col gap-2">
              <GuestBuyPackagePanel packageId={pkg.id} disabled={!paynow.configured} />
              <p className={`text-xs ${ui.muted}`}>
                Already have an account?{" "}
                <Link href={`/auth?next=${encodeURIComponent(signInNext)}`} className={ui.link}>
                  Sign in
                </Link>
              </p>
            </div>
          )}
          <Link href="/booking" className={ui.btnSecondary}>
            Browse all classes
          </Link>
        </div>
      </div>
    </main>
  );
}
