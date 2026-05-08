import { createStudioService, deleteStudioService, updateStudioService } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { CoverVideoFields } from "@/components/dashboard/PublicMediaFields";
import { ServiceDetailLinkButton } from "@/components/dashboard/ServiceDetailLinkButton";
import { getDashboardScope } from "@/lib/dashboard";
import { formatPublicTagsInput } from "@/lib/publicTags";
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
      .select("id, title, summary, description, price, currency, cover_image_url, video_url, tags, is_active, sort_order")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Service setup</h1>
          <p className={ui.muted}>Create and maintain the public services shown on /{studio.public_slug}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/schedule", selectedStudioId, selectedLocationId)} className={ui.btnSecondarySm}>
          Back to sessions
        </DashboardAppLink>
      </div>

      <details className={`chevron ${ui.card}`}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>+ Add service</span>
          <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
        </summary>
        <form action={createStudioService} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={studio.id} />
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Title</span>
            <input name="title" required className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Summary</span>
            <input name="summary" className={ui.input} />
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
          <div className="hidden sm:block" />

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Description</span>
            <textarea name="description" rows={4} className={`${ui.input} min-h-28`} />
          </label>

          <div className="sm:col-span-2">
            <CoverVideoFields
              studioId={studio.id}
              folder="services"
              entityId="new-service"
              title="Service media"
              coverName="cover_image_url"
              videoName="video_url"
              coverDefaultValue={null}
              videoDefaultValue={null}
              coverLabel="Cover image"
              videoLabel="Promo video URL"
            />
          </div>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Tags</span>
            <textarea
              name="tags_input"
              rows={3}
              className={`${ui.input} min-h-20`}
              placeholder={`Private session\nBeginner friendly\n60 min`}
            />
            <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
          </label>

          <SubmitButton className={`${ui.btnPrimary} w-full sm:col-span-2 sm:w-fit`} pendingText="Creating...">
            Create service
          </SubmitButton>
        </form>
      </details>

      <div className="grid gap-4">
        {(services ?? []).map((svc) => (
          <form key={svc.id} action={updateStudioService} className={ui.card}>
            <input type="hidden" name="studio_id" value={studio.id} />
            <input type="hidden" name="service_id" value={svc.id} />
            <details className="chevron">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900 sm:size-[72px]">
                    {(svc.cover_image_url as string | null) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={String(svc.cover_image_url)} alt="" className="size-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{svc.title}</h3>
                      {!svc.is_active ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      {svc.price != null ? (
                        <>
                          {svc.currency ?? "SGD"} {Number(svc.price).toFixed(2)}
                        </>
                      ) : null}
                      {svc.summary ? ` · ${svc.summary}` : ""}
                    </p>
                    {(() => {
                      const raw = (svc as { tags?: string[] | null }).tags;
                      const tags = Array.isArray(raw)
                        ? Array.from(new Map(raw.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values()).filter(Boolean)
                        : [];
                      return tags.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {tags.slice(0, 4).map((tag) => (
                          <span
                            key={`${svc.id}-${tag.toLowerCase()}`}
                            className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <ServiceDetailLinkButton serviceId={svc.id} />
                  <button type="submit" formAction={deleteStudioService} className={`${ui.btnDangerSm} px-2`}>
                    Remove
                  </button>
                </div>
              </summary>

              <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="is_active" defaultChecked={Boolean(svc.is_active)} />
                  Active
                </label>

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Title</span>
                  <input name="title" required defaultValue={svc.title} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
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
                <div className="hidden sm:block" />

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Description</span>
                  <textarea name="description" rows={4} defaultValue={svc.description ?? ""} className={`${ui.input} min-h-28`} />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Tags</span>
                  <textarea
                    name="tags_input"
                    rows={3}
                    defaultValue={formatPublicTagsInput((svc as { tags?: string[] | null }).tags)}
                    className={`${ui.input} min-h-20`}
                  />
                  <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
                </label>
                <div className="sm:col-span-2">
                  <CoverVideoFields
                    studioId={studio.id}
                    folder="services"
                    entityId={svc.id}
                    title={svc.title}
                    coverName="cover_image_url"
                    videoName="video_url"
                    coverDefaultValue={svc.cover_image_url ?? null}
                    videoDefaultValue={svc.video_url ?? null}
                    coverLabel="Cover image"
                    videoLabel="Promo video URL"
                  />
                </div>

                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">
                    Save changes
                  </SubmitButton>
                </div>
              </div>
            </details>
          </form>
        ))}
      </div>
    </div>
  );
}
