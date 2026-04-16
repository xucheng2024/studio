import { createPackage } from "@/app/dashboard/actions";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function PackagesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Create a studio from the overview first.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }
  if (!["owner", "manager"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have packages access.</p>;
  }

  let packagesQuery = supabase
    .from("packages")
    .select("id, name, credits, price, expiry_days, is_drop_in, studio_id, location_id")
    .in("studio_id", studioIds)
    .order("price");
  if (selectedLocationId) packagesQuery = packagesQuery.eq("location_id", selectedLocationId);
  const { data: packages } = await packagesQuery;

  const studioId = packages?.[0]?.studio_id ?? studioIds[0];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Packages</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Add a drop-in template: name it &quot;Drop-in&quot;, mark drop-in, set price — used for
          single-visit checkout.
        </p>
        <form action={createPackage} className={`${ui.card} mt-6 grid max-w-lg gap-4`}>
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Name</span>
            <input name="name" required className={ui.input} placeholder="10 Class Pack" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Credits</span>
            <input
              name="credits"
              type="number"
              min={1}
              defaultValue={10}
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Price</span>
            <input
              name="price"
              type="number"
              min={0}
              step="0.01"
              defaultValue={120}
              className={ui.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Expiry days (empty = none)</span>
            <input name="expiry_days" type="number" min={1} className={ui.input} />
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input
              name="is_drop_in"
              type="checkbox"
              className="size-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
            />
            Drop-in template
          </label>
          <button type="submit" className={`${ui.btnPrimary} w-fit`}>
            Save package
          </button>
        </form>
      </div>

      <ul className="flex flex-col gap-3">
        {(packages ?? []).map((p) => (
          <li key={p.id} className={ui.card}>
            <p className="font-medium text-stone-900 dark:text-stone-100">{p.name}</p>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              {p.credits} credits · ${p.price}
              {p.is_drop_in ? " · drop-in" : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
