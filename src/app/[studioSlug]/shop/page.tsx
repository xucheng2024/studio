import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioShopProductPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function PublicShopPage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, public_shop_title")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const shopTitle = (studio as { public_shop_title?: string | null }).public_shop_title?.trim() || "Shop";

  const { data: products } = await admin
    .from("shop_products")
    .select("id, title, summary, image_url, price, currency, share_slug, stock_qty")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#shop`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4">
        <h1 className={ui.h1}>{shopTitle}</h1>
        <p className={`mt-1 ${ui.muted}`}>Browse merchandise from {studio.name}.</p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        {(products ?? []).map((product, idx) => {
          const href = studioShopProductPath(studio.public_slug, product.share_slug ?? product.id);
          const outOfStock = product.stock_qty != null && Number(product.stock_qty) < 1;
          const currency = String(product.currency ?? "SGD").toUpperCase();
          return (
            <article key={product.id} className={`${ui.card} flex flex-col`}>
              <Link href={href} className="block shrink-0">
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.title}
                    width={600}
                    height={600}
                    sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 320px"
                    priority={idx === 0}
                    className="aspect-square w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                )}
              </Link>
              <div className="mt-3 flex flex-1 flex-col">
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 sm:text-base">
                  <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                    {product.title}
                  </Link>
                </h2>
                <p className="mt-1 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-50">
                  {currency} {Number(product.price).toFixed(2)}
                </p>
                {product.summary ? <p className={`mt-1 line-clamp-2 text-xs ${ui.muted}`}>{product.summary}</p> : null}
                {outOfStock ? <p className={`mt-2 text-xs ${ui.error}`}>Out of stock</p> : null}
                <div className="mt-auto pt-3">
                  <Link href={href} className={ui.btnPrimarySm}>
                    View
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!products?.length ? <p className={`mt-6 text-sm ${ui.muted}`}>No products available.</p> : null}
    </main>
  );
}
