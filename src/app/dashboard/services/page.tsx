import { createStudioService, deleteStudioService, updateStudioService } from "@/app/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { CoverUrlField } from "@/components/dashboard/PublicMediaFields";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null, locationId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  if (locationId) p.set("location_id", locationId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function DashboardServicesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  if (!studioId) return <p className={ui.muted}>Create a studio first.</p>;

  const [{ data: studio }, { data: services }] = await Promise.all([
    supabase.from("studios").select("id, name, public_slug").eq("id", studioId).maybeSingle(),
    supabase
      .from("studio_services")
      .select("id, title, summary, description, price, currency, cover_image_url, video_url, is_active, sort_order")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Services Management</h1>
          <p className={ui.muted}>Manage public services shown on /{studio.public_slug}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId, selectedLocationId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      <form action={createStudioService} className={`${ui.card} grid gap-3`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <h2 className={ui.h2}>Add service</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Title</span>
            <input name="title" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Price</span>
            <input name="price" type="number" min="0" step="0.01" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Currency</span>
            <input name="currency" defaultValue="SGD" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Sort order</span>
            <input name="sort_order" type="number" defaultValue={100} className={ui.input} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Summary</span>
          <input name="summary" className={ui.input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Description</span>
          <textarea name="description" rows={4} className={`${ui.input} min-h-28`} />
        </label>
        <CoverUrlField
          studioId={studio.id}
          folder="services"
          entityId={`new-${Date.now()}`}
          name="cover_image_url"
          label="Cover image"
          defaultValue={null}
        />
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Video URL</span>
          <input name="video_url" placeholder="https://..." className={ui.input} />
        </label>
        <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Creating...">
          Create service
        </SubmitButton>
      </form>

      <div className="grid gap-4">
        {(services ?? []).map((svc) => (
          <form key={svc.id} action={updateStudioService} className={`${ui.card} grid gap-3`}>
            <input type="hidden" name="studio_id" value={studio.id} />
            <input type="hidden" name="service_id" value={svc.id} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{svc.title}</h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={Boolean(svc.is_active)} />
                Active
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Title</span>
                <input name="title" required defaultValue={svc.title} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Summary</span>
                <input name="summary" defaultValue={svc.summary ?? ""} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Price</span>
                <input name="price" type="number" min="0" step="0.01" defaultValue={Number(svc.price ?? 0)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Currency</span>
                <input name="currency" defaultValue={svc.currency ?? "SGD"} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Sort order</span>
                <input name="sort_order" type="number" defaultValue={svc.sort_order ?? 100} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Video URL</span>
                <input name="video_url" defaultValue={svc.video_url ?? ""} className={ui.input} />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Description</span>
              <textarea name="description" rows={4} defaultValue={svc.description ?? ""} className={`${ui.input} min-h-28`} />
            </label>
            <CoverUrlField
              studioId={studio.id}
              folder="services"
              entityId={svc.id}
              name="cover_image_url"
              label="Cover image"
              defaultValue={svc.cover_image_url}
            />
            <div className="flex flex-wrap gap-2">
              <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">
                Save changes
              </SubmitButton>
              <button type="submit" formAction={deleteStudioService} className={ui.btnDangerSm}>
                Delete
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
