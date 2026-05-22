import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopProductCard } from "@/components/ShopProductCard";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioShopPath, studioShopProductPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Shop",
    description: "Browse products, prices, and stock availability.",
    path: studioShopPath(studioSlug),
  });
}

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
    .select("id, title, summary, image_url, price, share_slug, stock_qty")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#shop`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4">
        <h1 className={ui.h1}>{shopTitle}</h1>
        <p className={`mt-1 text-sm ${ui.muted}`}>Browse merchandise from {studio.name}.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5">
        {(products ?? []).map((product, idx) => (
          <ShopProductCard
            key={product.id}
            href={studioShopProductPath(studio.public_slug, product.share_slug ?? product.id)}
            title={product.title}
            imageUrl={product.image_url}
            price={Number(product.price)}
            summary={product.summary}
            outOfStock={product.stock_qty != null && Number(product.stock_qty) < 1}
            priority={idx < 2}
          />
        ))}
      </div>
      {!products?.length ? <p className={`mt-6 text-sm ${ui.muted}`}>No products available.</p> : null}
    </main>
  );
}
