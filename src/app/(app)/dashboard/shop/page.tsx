import Image from "next/image";
import {
  createShopProduct,
  deleteShopProduct,
  updateShopOrderFulfillment,
  updateShopProduct,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { CoverUrlField } from "@/components/dashboard/PublicMediaFields";
import { ShopExtraImagesField } from "@/components/dashboard/ShopExtraImagesField";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

export default async function DashboardShopPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) return <p className={ui.muted}>Create your first studio in Overview.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role)) return <p className={ui.muted}>You do not have access to this page.</p>;

  const studioId = selectedStudioId ?? studioIds[0];
  const [{ data: studio }, { data: products }, { data: orders }] = await Promise.all([
    supabase.from("studios").select("id, public_slug").eq("id", studioId).maybeSingle(),
    supabase
      .from("shop_products")
      .select("id, title, summary, description, image_url, image_urls, price, currency, stock_qty, sort_order, is_active, share_slug")
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

  const publicHref = studio.public_slug ? `/${studio.public_slug}#shop` : null;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Shop setup</h1>
          <p className={ui.muted}>Sell merchandise on your public studio page. Customers pay via HitPay and provide a shipping address.</p>
        </div>
        {publicHref ? (
          <DashboardAppLink href={publicHref} className={ui.btnSecondarySm}>
            View public page
          </DashboardAppLink>
        ) : null}
      </div>

      <details className={`chevron ${ui.card}`}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>+ Add product</span>
          <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
        </summary>
        <form action={createShopProduct} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={studio.id} />
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
            <span className={ui.label}>Price</span>
            <input name="price" type="number" min={0.01} step={0.01} required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Currency</span>
            <input name="currency" defaultValue="SGD" className={ui.input} />
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
        </form>
      </details>

      <div className="grid gap-4">
        {(products ?? []).map((product) => (
          <div key={product.id} className={ui.card}>
            <form action={updateShopProduct}>
              <input type="hidden" name="studio_id" value={studio.id} />
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
                      {String(product.currency ?? "SGD")} {Number(product.price).toFixed(2)}
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
                    <span className={ui.label}>Price</span>
                    <input name="price" type="number" min={0.01} step={0.01} required defaultValue={product.price} className={ui.input} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Currency</span>
                    <input name="currency" defaultValue={product.currency ?? "SGD"} className={ui.input} />
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
                    <button type="submit" formAction={deleteShopProduct} className={ui.btnDangerSm}>
                      Hide product
                    </button>
                  </div>
                </div>
              </details>
            </form>
          </div>
        ))}
        {!products?.length ? <p className={`text-sm ${ui.muted}`}>No products yet.</p> : null}
      </div>

      {(orders ?? []).length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className={ui.h2}>Paid orders</h2>
          <ul className="flex flex-col gap-2">
            {(orders ?? []).map((order) => (
              <li key={order.id} className={ui.card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{order.product_title_snapshot}</p>
                    <p className={`text-sm ${ui.muted}`}>
                      {order.shipping_name} · {order.shipping_city} {order.shipping_postal_code}
                    </p>
                    <p className={`text-xs ${ui.muted}`}>
                      {order.currency} {Number(order.amount).toFixed(2)}
                      {order.paid_at
                        ? ` · Paid ${new Date(order.paid_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })}`
                        : ""}
                    </p>
                  </div>
                  <form action={updateShopOrderFulfillment} className="flex items-center gap-2">
                    <input type="hidden" name="studio_id" value={studio.id} />
                    <input type="hidden" name="order_id" value={order.id} />
                    <select name="fulfillment_status" defaultValue={order.fulfillment_status ?? "unfulfilled"} className={ui.select}>
                      <option value="unfulfilled">Unfulfilled</option>
                      <option value="shipped">Shipped</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <SubmitButton className={ui.btnSecondarySm} pendingText="...">
                      Update
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
