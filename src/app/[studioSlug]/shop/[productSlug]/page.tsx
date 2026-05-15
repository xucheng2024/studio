import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BuyShopProductPanel } from "@/components/BuyShopProductPanel";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { studioShopPath } from "@/lib/public-paths";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string; productSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug: rawStudio, productSlug: rawProduct } = await params;
  const studioSlug = normalizeStudioSlug(rawStudio ?? "");
  const productSlug = String(rawProduct ?? "").trim().toLowerCase();
  if (!studioSlug) return { title: "Shop" };
  const admin = createAdminClient();
  const { data: studio } = await admin.from("studios").select("id, name").eq("public_slug", studioSlug).maybeSingle();
  if (!studio) return { title: "Shop" };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productSlug);
  const { data: product } = await admin
    .from("shop_products")
    .select("title")
    .eq("studio_id", studio.id)
    .eq(isUuid ? "id" : "share_slug", productSlug)
    .eq("is_active", true)
    .maybeSingle();
  return { title: product?.title ? `${product.title} · ${studio.name}` : `Shop · ${studio.name}` };
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
    .select("id, title, summary, description, image_url, price, currency, stock_qty, share_slug")
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

  const paymentReady = Boolean(studio.hitpay_enabled);
  const outOfStock = product.stock_qty != null && Number(product.stock_qty) < 1;
  const currency = String(product.currency ?? "SGD").toUpperCase();

  return (
    <main className={ui.page}>
      <div className="mb-4">
        <StudioPublicBackNav href={studioShopPath(studio.public_slug)}>Back to shop</StudioPublicBackNav>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <p className={ui.badge}>Shop</p>
          <h1 className={`${ui.h1} mt-3`}>{product.title}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {currency} {Number(product.price).toFixed(2)}
          </p>
          {product.summary ? <p className={`mt-3 text-sm ${ui.muted}`}>{product.summary}</p> : null}
          {product.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">{product.description}</p>
          ) : null}
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.title}
              width={1200}
              height={1200}
              sizes="(max-width: 1024px) 100vw, 600px"
              priority
              className="mt-6 aspect-square w-full max-w-lg rounded-xl border border-stone-200 object-cover dark:border-stone-800"
            />
          ) : null}
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Buy this item</p>
            <p className={`mt-1 text-sm ${paymentReady && !outOfStock ? ui.muted : ui.error}`}>
              {!paymentReady
                ? "Online payment is not configured for this studio."
                : outOfStock
                  ? "This item is out of stock."
                  : "Secure checkout powered by HitPay. Shipping address required."}
            </p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {currency} {Number(product.price).toFixed(2)}
            </p>
            <div className="mt-5">
              <BuyShopProductPanel
                productId={product.id}
                disabled={!paymentReady || outOfStock}
                outOfStock={outOfStock}
                shippingDefaults={shippingDefaults}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
