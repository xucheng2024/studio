import { createPackage } from "@/app/dashboard/actions";
import { PackageLifecycleRow } from "@/components/dashboard/PackageLifecycleRow";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
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
    return <p className={ui.muted}>Create your first studio in Overview.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const canEdit = ["owner", "manager"].includes(role);
  const canCopyLink = ["owner", "manager", "frontdesk"].includes(role);

  let packagesQuery = supabase
    .from("packages")
    .select(
      "id, name, credits, price, expiry_days, studio_id, location_id, is_active, share_slug, studios ( public_slug )",
    )
    .in("studio_id", studioIds)
    .order("price");
  if (selectedLocationId) packagesQuery = packagesQuery.eq("location_id", selectedLocationId);
  const { data: packages } = await packagesQuery;

  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");

  const studioId = packages?.[0]?.studio_id ?? studioIds[0];

  const backParams = new URLSearchParams();
  if (selectedStudioId) backParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
  const backHref = `/dashboard/schedule${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  const locsForStudio = (locationRows ?? []).filter((l) => l.studio_id === studioId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Packages</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Create and share credit packs. Single-visit pricing is set per session in Schedule.
        </p>
        <div className="mt-3">
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to schedule
          </DashboardAppLink>
        </div>
        {canEdit ? (
          <details className={`chevron ${ui.card} mt-5 max-w-md`} id="create-package">
            <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100">
              <span>+ New package</span>
              <span className={`text-xs font-normal ${ui.muted}`}>Expand to create</span>
            </summary>
            <form action={createPackage} className="mt-4 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={studioId} />
              <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Name</span>
                <input name="name" required className={ui.input} placeholder="10 Class Pack" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Credits</span>
                <input name="credits" type="number" min={1} defaultValue={10} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Price</span>
                <input name="price" type="number" min={0} step="0.01" defaultValue={120} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Expiry days (empty = none)</span>
                <input name="expiry_days" type="number" min={1} className={ui.input} />
              </label>
              <SubmitButton className={`${ui.btnPrimary} w-fit sm:col-span-2`} pendingText="Saving...">
                Save package
              </SubmitButton>
            </form>
          </details>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3">
        {(packages ?? []).map((p) => {
          const st = p.studios as { public_slug?: string | null } | { public_slug?: string | null }[] | null;
          const pub = Array.isArray(st) ? st[0]?.public_slug : st?.public_slug;
          return (
            <li key={p.id} className={`${ui.card} p-4!`}>
              <p className="font-medium text-stone-900 dark:text-stone-100">{p.name}</p>
              <p className={`mt-0.5 text-sm ${ui.muted}`}>
                {p.credits} credits · ${p.price}
                {p.is_active === false ? " · Stopped" : ""}
              </p>
              <div className="mt-2">
                <PackageLifecycleRow
                  packageId={p.id}
                  studioPublicSlug={pub ?? null}
                  shareSlug={p.share_slug ?? null}
                  isActive={p.is_active !== false}
                  canEdit={canEdit}
                  canCopyLink={canCopyLink}
                  initial={{
                    name: p.name,
                    credits: p.credits,
                    price: Number(p.price),
                    expiry_days: p.expiry_days,
                    location_id: p.location_id,
                  }}
                  locations={locsForStudio}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
