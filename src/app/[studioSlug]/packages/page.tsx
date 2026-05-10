import Link from "next/link";
import { notFound } from "next/navigation";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioPackagePath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };


export default async function PublicPackagesPage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, public_packages_title, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: packages } = await admin
    .from("packages")
    .select("id, name, price, credits, expiry_days, share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("price", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#packages`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4">
        <h1 className={ui.h1}>{studio.public_packages_title?.trim() || "Packages"}</h1>
        <p className={`mt-1 ${ui.muted}`}>Buy a class pass pack and book any upcoming session.</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {(packages ?? []).map((pkg) => {
          const href = pkg.share_slug ? studioPackagePath(studio.public_slug, pkg.share_slug) : null;
          const currency = String((pkg as { currency?: string | null }).currency ?? "SGD").toUpperCase();
          return (
            <article key={pkg.id} className={`${ui.card} flex flex-col`}>
              <div className="flex flex-1 flex-col">
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {href ? <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">{pkg.name}</Link> : pkg.name}
                </h2>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className={`text-sm ${ui.muted}`}>{pkg.credits} class pass{Number(pkg.credits) !== 1 ? "es" : ""}</span>
                  <span className={`text-sm ${ui.muted}`}>· {pkg.expiry_days ? `Expires in ${pkg.expiry_days} days` : "No expiry"}</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  {pkg.price != null ? <span className="text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">{currency} {Number(pkg.price).toFixed(2)}</span> : null}
                  {href ? <Link href={href} className={ui.btnPrimary}>Buy now</Link> : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
