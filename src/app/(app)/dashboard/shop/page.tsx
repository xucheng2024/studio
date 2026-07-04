import Image from "next/image";
import {
  createShopProduct,
  deleteShopProduct,
  updateShopOrderFulfillment,
  updateShopProduct,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { CoverUrlField } from "@/components/dashboard/PublicMediaFields";
import { ShopExtraImagesField } from "@/components/dashboard/ShopExtraImagesField";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string; fulfillment?: string }> };

export default async function DashboardShopPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: null,
  }, ["owner", "manager"]);
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const fulfillmentFilter =
    sp.fulfillment === "unfulfilled" || sp.fulfillment === "shipped" || sp.fulfillment === "cancelled"
      ? sp.fulfillment
      : "all";
  const [{ data: studio }, { data: products }, { data: orders }] = await Promise.all([
    supabase.from("studios").select("id, public_slug").eq("id", studioId).maybeSingle(),
    supabase
      .from("shop_products")
      .select("id, title, summary, description, image_url, image_urls, price, stock_qty, sort_order, is_active, share_slug")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("shop_orders")
      .select(
        "id, status, fulfillment_status, product_title_snapshot, amount, currency, shipping_name, shipping_city, shipping_postal_code, created_at, paid_at",
      )
      .eq("studio_id", studioId)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;
  const filteredOrders = (orders ?? []).filter((order) =>
    fulfillmentFilter === "all" ? true : (order.fulfillment_status ?? "unfulfilled") === fulfillmentFilter,
  );
  const orderCounts = {
    all: (orders ?? []).length,
    unfulfilled: (orders ?? []).filter((order) => (order.fulfillment_status ?? "unfulfilled") === "unfulfilled").length,
    shipped: (orders ?? []).filter((order) => (order.fulfillment_status ?? "unfulfilled") === "shipped").length,
    cancelled: (orders ?? []).filter((order) => (order.fulfillment_status ?? "unfulfilled") === "cancelled").length,
  };

  const publicHref = studio.public_slug ? `/${studio.public_slug}#shop` : null;
  const scopedShopHref = (fulfillment: "all" | "unfulfilled" | "shipped" | "cancelled") => {
    const params = new URLSearchParams();
    params.set("studio_id", studio.id);
    if (fulfillment !== "all") params.set("fulfillment", fulfillment);
    return `/dashboard/shop?${params.toString()}`;
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Shop setup</h1>
          <p className={ui.muted}>Sell merchandise on your public studio page. Paid orders use HitPay, while free orders skip payment and still collect a shipping address.</p>
        </div>
        {publicHref ? (
          <DashboardAppLink href={publicHref} className={ui.btnSecondarySm}>
            View public page
          </DashboardAppLink>
        ) : null}
      </div>

      <div className={`${ui.card} flex flex-col gap-2`}>
        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Studio-level catalog</p>
        <p className={`text-sm ${ui.muted}`}>
          Shop products and fulfillment are managed at the studio level. Location is not used as a filter on this page.
        </p>
      </div>

      <details className={`chevron ${ui.card}`}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>+ Add product</span>
          <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
        </summary>
        <ServerActionToastForm action={createShopProduct} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={studio.id} />
          <input type="hidden" name="fulfillment" value={fulfillmentFilter} />
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Title</span>
            <input name="title" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Summary</span>
            <input name="summary" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Description</span>
            <textarea name="description" rows={3} className={`${ui.input} min-h-24`} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Price (SGD)</span>
            <input name="price" type="number" min={0} step={0.01} required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Stock (blank = unlimited)</span>
            <input name="stock_qty" type="number" min={0} step={1} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Sort order</span>
            <input name="sort_order" type="number" defaultValue={100} className={ui.input} />
          </label>
          <div className="sm:col-span-2">
            <CoverUrlField
              studioId={studio.id}
              folder="shop"
              entityId="new-product"
              name="image_url"
              label="Cover image (used in listings)"
              defaultValue={null}
              cropAspect={1}
              oneToOnePreview="square"
            />
          </div>
          <div className="sm:col-span-2">
            <ShopExtraImagesField
              studioId={studio.id}
              entityId="new-product"
              defaultValues={[]}
            />
          </div>
          <SubmitButton className={`${ui.btnPrimary} w-full sm:col-span-2 sm:w-fit`} pendingText="Creating...">
            Create product
          </SubmitButton>
        </ServerActionToastForm>
      </details>

      <div className="grid gap-4">
        {(products ?? []).map((product) => (
          <div key={product.id} className={ui.card}>
            <ServerActionToastForm action={updateShopProduct}>
              <input type="hidden" name="studio_id" value={studio.id} />
              <input type="hidden" name="fulfillment" value={fulfillmentFilter} />
              <input type="hidden" name="product_id" value={product.id} />
              <details className="chevron">
                <summary className="flex cursor-pointer items-center gap-3">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt=""
                      width={64}
                      height={64}
                      className="size-14 shrink-0 rounded-lg border border-stone-200 object-cover dark:border-stone-700"
                    />
                  ) : (
                    <div className="size-14 shrink-0 rounded-lg bg-stone-100 dark:bg-stone-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{product.title}</p>
                    <p className={`text-sm ${ui.muted}`}>
                      {Number(product.price) === 0 ? "Free" : `SGD ${Number(product.price).toFixed(2)}`}
                      {product.stock_qty != null ? ` · ${product.stock_qty} in stock` : " · Unlimited stock"}
                      {!product.is_active ? " · Hidden" : ""}
                    </p>
                  </div>
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className={ui.label}>Title</span>
                    <input name="title" required defaultValue={product.title} className={ui.input} />
                  </label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className={ui.label}>Summary</span>
                    <input name="summary" defaultValue={product.summary ?? ""} className={ui.input} />
                  </label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className={ui.label}>Description</span>
                    <textarea name="description" rows={3} defaultValue={product.description ?? ""} className={`${ui.input} min-h-24`} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Price (SGD)</span>
                    <input name="price" type="number" min={0} step={0.01} required defaultValue={product.price} className={ui.input} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Stock (blank = unlimited)</span>
                    <input
                      name="stock_qty"
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={product.stock_qty ?? ""}
                      className={ui.input}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Sort order</span>
                    <input name="sort_order" type="number" defaultValue={product.sort_order ?? 100} className={ui.input} />
                  </label>
                  <label className="flex items-center gap-2 sm:col-span-2">
                    <input type="checkbox" name="is_active" defaultChecked={product.is_active} />
                    <span className={ui.label}>Visible on public page</span>
                  </label>
                  <div className="sm:col-span-2">
                    <CoverUrlField
                      studioId={studio.id}
                      folder="shop"
                      entityId={product.id}
                      name="image_url"
                      label="Cover image (used in listings)"
                      defaultValue={product.image_url}
                      cropAspect={1}
                      oneToOnePreview="square"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <ShopExtraImagesField
                      studioId={studio.id}
                      entityId={product.id}
                      defaultValues={(product.image_urls as string[] | null) ?? []}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">
                      Save
                    </SubmitButton>
                    <ToastConfirmForm
                      action={deleteShopProduct}
                      confirmMessage="Hide this product from the public page?"
                      confirmLabel="Hide"
                      pendingLabel="Hiding..."
                    >
                      <input type="hidden" name="studio_id" value={studio.id} />
                      <input type="hidden" name="fulfillment" value={fulfillmentFilter} />
                      <input type="hidden" name="product_id" value={product.id} />
                      <button type="submit" className={ui.btnDangerSm}>
                        Hide product
                      </button>
                    </ToastConfirmForm>
                  </div>
                </div>
              </details>
            </ServerActionToastForm>
          </div>
        ))}
        {!products?.length ? <p className={`text-sm ${ui.muted}`}>No products yet.</p> : null}
      </div>

      {(orders ?? []).length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className={ui.h2}>Completed orders</h2>
              <p className={`mt-1 text-sm ${ui.muted}`}>Use the unfulfilled filter to work the shipping queue first.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <DashboardAppLink href={scopedShopHref("unfulfilled")} className={fulfillmentFilter === "unfulfilled" ? ui.btnPrimarySm : ui.btnSecondarySm}>
                Unfulfilled ({orderCounts.unfulfilled})
              </DashboardAppLink>
              <DashboardAppLink href={scopedShopHref("all")} className={fulfillmentFilter === "all" ? ui.btnPrimarySm : ui.btnSecondarySm}>
                All ({orderCounts.all})
              </DashboardAppLink>
              <DashboardAppLink href={scopedShopHref("shipped")} className={fulfillmentFilter === "shipped" ? ui.btnPrimarySm : ui.btnSecondarySm}>
                Shipped ({orderCounts.shipped})
              </DashboardAppLink>
              <DashboardAppLink href={scopedShopHref("cancelled")} className={fulfillmentFilter === "cancelled" ? ui.btnPrimarySm : ui.btnSecondarySm}>
                Cancelled ({orderCounts.cancelled})
              </DashboardAppLink>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {filteredOrders.map((order) => (
              <li key={order.id} className={ui.card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{order.product_title_snapshot}</p>
                    <p className={`text-sm ${ui.muted}`}>
                      {order.shipping_name} · {order.shipping_city} {order.shipping_postal_code}
                    </p>
                    <p className={`text-xs ${ui.muted}`}>
                      {Number(order.amount) === 0 ? "Free" : `${order.currency} ${Number(order.amount).toFixed(2)}`}
                      {order.paid_at
                        ? <> · Paid <LocalTime iso={order.paid_at} /></>
                        : null}
                    </p>
                  </div>
                  <ServerActionToastForm action={updateShopOrderFulfillment} className="flex items-center gap-2">
                    <input type="hidden" name="studio_id" value={studio.id} />
                    <input type="hidden" name="fulfillment" value={fulfillmentFilter} />
                    <input type="hidden" name="order_id" value={order.id} />
                    <select name="fulfillment_status" defaultValue={order.fulfillment_status ?? "unfulfilled"} className={ui.select}>
                      <option value="unfulfilled">Unfulfilled</option>
                      <option value="shipped">Shipped</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <SubmitButton className={ui.btnSecondarySm} pendingText="...">
                      Update
                    </SubmitButton>
                  </ServerActionToastForm>
                </div>
              </li>
            ))}
          </ul>
          {!filteredOrders.length ? (
            <div className={ui.emptyState}>
              <p className={`text-sm ${ui.muted}`}>No orders in this fulfillment state.</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
