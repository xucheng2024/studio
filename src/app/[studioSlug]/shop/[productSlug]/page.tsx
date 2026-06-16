import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BuyShopProductPanel } from "@/components/BuyShopProductPanel";
import { ShopImageGallery } from "@/components/ShopImageGallery";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { studioShopPath, studioShopProductPath } from "@/lib/public-paths";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import { getAppOriginForOg } from "@/lib/coverMedia";
import { formatPriceOrFree, isZeroAmount } from "@/lib/priceDisplay";

type Props = { params: Promise<{ studioSlug: string; productSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug: rawStudio, productSlug: rawProduct } = await params;
  const origin = getAppOriginForOg();
  const studioSlug = normalizeStudioSlug(rawStudio ?? "");
  const productSlug = String(rawProduct ?? "").trim().toLowerCase();
  if (!studioSlug) return { title: "Shop" };
  const admin = createAdminClient();
  const { data: studio } = await admin.from("studios").select("id, name").eq("public_slug", studioSlug).maybeSingle();
  if (!studio) return { title: "Shop" };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productSlug);
  const { data: product } = await admin
    .from("shop_products")
    .select("id, title, summary, description, share_slug")
    .eq("studio_id", studio.id)
    .eq(isUuid ? "id" : "share_slug", productSlug)
    .eq("is_active", true)
    .maybeSingle();
  const canonicalSlug = product?.share_slug ?? (isUuid ? product?.id : productSlug);
  const canonicalPath = canonicalSlug ? studioShopProductPath(studioSlug, canonicalSlug) : null;
  const description = product?.summary?.trim() || product?.description?.trim() || `Shop ${studio.name}`;
  return {
    title: product?.title ? `${product.title} · ${studio.name}` : `Shop · ${studio.name}`,
    description,
    ...(origin && canonicalPath ? { alternates: { canonical: `${origin}${canonicalPath}` } } : {}),
  };
}

export default async function PublicShopProductPage({ params }: Props) {
  const { studioSlug: rawStudio, productSlug: rawProduct } = await params;
  const studioSlug = normalizeStudioSlug(rawStudio ?? "");
  const productSlug = String(rawProduct ?? "").trim().toLowerCase();
  if (!studioSlug || !productSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productSlug);
  const { data: product } = await admin
    .from("shop_products")
    .select("id, title, summary, description, image_url, image_urls, price, stock_qty, share_slug")
    .eq("studio_id", studio.id)
    .eq(isUuid ? "id" : "share_slug", productSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (!product) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let shippingDefaults = null;
  if (user) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select(
        "shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country, full_name, phone",
      )
      .eq("id", user.id)
      .maybeSingle();
    if (profile) {
      shippingDefaults = {
        shipping_name: profile.shipping_name ?? profile.full_name ?? "",
        shipping_phone: profile.shipping_phone ?? profile.phone ?? "",
        shipping_address_line1: profile.shipping_address_line1 ?? "",
        shipping_address_line2: profile.shipping_address_line2,
        shipping_city: profile.shipping_city ?? "",
        shipping_postal_code: profile.shipping_postal_code ?? "",
        shipping_country: profile.shipping_country ?? "SG",
      };
    }
  }

  const isFreeProduct = isZeroAmount(product.price);
  const paymentReady = isFreeProduct || Boolean(studio.hitpay_enabled);
  const outOfStock = product.stock_qty != null && Number(product.stock_qty) < 1;
  const currency = STUDIO_CURRENCY;
  const sharePath = studioShopProductPath(studio.public_slug, product.share_slug ?? product.id);

  // Only show description if it differs from summary (avoids duplicate text from seeded data).
  const descriptionText = product.description?.trim() ?? "";
  const summaryText = product.summary?.trim() ?? "";
  const showDescription = descriptionText && descriptionText !== summaryText;

  return (
    <main className={ui.page}>
      <div className="mb-4">
        <StudioPublicBackNav href={studioShopPath(studio.public_slug)}>Back to shop</StudioPublicBackNav>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* Left: image gallery + info */}
        <div className="min-w-0">
          <ShopImageGallery
            mainImage={product.image_url ?? null}
            extraImages={(product.image_urls as string[] | null) ?? []}
            alt={product.title}
            priority
            sharePath={sharePath}
            shareTitle={`${product.title} · ${studio.name}`}
            shareText={`Check out ${product.title} at ${studio.name}`}
          />

          <div className="mt-6">
            <p className={ui.badge}>Shop</p>
            <h1 className={`${ui.h1} mt-2`}>{product.title}</h1>
            <p className={`mt-1 text-sm ${ui.muted}`}>{studio.name}</p>
            {summaryText ? (
              <p className={`mt-3 text-base ${ui.muted}`}>{summaryText}</p>
            ) : null}
            {showDescription ? (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">
                {descriptionText}
              </p>
            ) : null}
          </div>
        </div>

        {/* Right: buy card */}
        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {formatPriceOrFree(currency, Number(product.price))}
            </p>
            {outOfStock ? (
              <p className={`mt-1 text-sm font-medium ${ui.error}`}>Out of stock</p>
            ) : (
              <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
                {isFreeProduct
                  ? "No payment required · Shipping address required"
                  : paymentReady
                  ? "Secure checkout · Shipping address required"
                  : "Online payment is not configured for this studio."}
              </p>
            )}
            <div className="mt-5">
              <BuyShopProductPanel
                productId={product.id}
                disabled={!paymentReady || outOfStock}
                outOfStock={outOfStock}
                shippingDefaults={shippingDefaults}
                actionLabel={isFreeProduct ? "Place free order" : "Buy now"}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
