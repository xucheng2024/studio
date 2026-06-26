import { createClassTemplate, createInstructor } from "@/app/(app)/dashboard/actions";
import { ClassTemplateLifecycleRow } from "@/components/dashboard/ClassTemplateLifecycleRow";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { CoverVideoFields } from "@/components/dashboard/PublicMediaFields";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function ClassesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner", "manager", "frontdesk"]);
  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  let instructorsQuery = supabase
    .from("instructors")
    .select("id, name, studio_id, location_id")
    .in("studio_id", studioIds)
    .order("name");
  if (selectedLocationId) instructorsQuery = instructorsQuery.eq("location_id", selectedLocationId);

  let classesQuery = supabase
    .from("classes")
    .select(
      `
      id,
      title,
      description,
      tags,
      studio_id,
      capacity,
      duration_min,
      instructor_id,
      location_id,
      is_active,
      share_slug,
      image_url,
      video_url,
      instructors ( name )
    `,
    )
    .in("studio_id", studioIds)
    .is("deleted_at", null)
    .order("title");
  if (selectedLocationId) classesQuery = classesQuery.eq("location_id", selectedLocationId);

  const locationRowsQuery = supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");

  // Run independent queries in parallel
  const [{ data: instructors }, { data: classes }, { data: locationRows }] = await Promise.all([
    instructorsQuery,
    classesQuery,
    locationRowsQuery,
  ]);

  const studioId = instructors?.[0]?.studio_id ?? classes?.[0]?.studio_id ?? studioIds[0];
  const canEdit = hasStudioRole(ctx, studioId, ["owner", "manager"]);
  const canCopyLink = hasStudioRole(ctx, studioId, ["owner", "manager", "frontdesk"]);

  // These two depend on studioId, run them in parallel with each other
  const [{ data: allInstructors }, { data: studioMeta }] = await Promise.all([
    supabase.from("instructors").select("id, name, studio_id").eq("studio_id", studioId).order("name"),
    supabase.from("studios").select("public_slug").eq("id", studioId).maybeSingle(),
  ]);

  const backParams = new URLSearchParams();
  if (selectedStudioId) backParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
  const backHref = `/dashboard/schedule${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  const locsForStudio = (locationRows ?? []).filter((l) => l.studio_id === studioId);
  const insList = (allInstructors ?? []).map((i) => ({ id: i.id, name: i.name }));
  const classCount = (classes ?? []).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Class setup</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className={ui.muted}>Manage instructors and reusable class templates for future sessions.</p>
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to sessions
          </DashboardAppLink>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className={ui.h2}>Instructors</h2>
          {canEdit ? (
            <details className="chevron rounded-xl border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-800 dark:text-stone-200">
                <span>+ Add instructor</span>
              </summary>
              <ServerActionToastForm action={createInstructor} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="studio_id" value={studioId} />
                <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
                <label className="flex min-w-40 flex-col gap-1.5">
                  <span className={ui.label}>Name</span>
                  <input name="name" required className={ui.input} placeholder="Alex Kim" />
                </label>
                <SubmitButton className={ui.btnPrimarySm} pendingText="Adding...">
                  Add
                </SubmitButton>
              </ServerActionToastForm>
            </details>
          ) : null}
        </div>
        <ul className={`mt-3 flex flex-wrap gap-2 text-sm ${ui.muted}`}>
          {(instructors ?? []).map((i) => (
            <li key={i.id} className="rounded-full bg-stone-100 px-3 py-1 dark:bg-stone-800">
              {i.name}
            </li>
          ))}
          {!(instructors ?? []).length ? (
            <li className={ui.muted}>No instructors yet.</li>
          ) : null}
        </ul>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className={ui.h2}>Class templates</h2>
            <span className={ui.badgeNeutral}>{classCount}</span>
          </div>
          {canEdit ? (
            <details className="chevron rounded-xl border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900" id="create-class-template">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-900 dark:text-stone-100">
                <span>+ New class template</span>
              </summary>
              <ServerActionToastForm action={createClassTemplate} className="mt-4 grid min-w-[min(42rem,calc(100vw-4rem))] gap-3 md:grid-cols-2">
                <input type="hidden" name="studio_id" value={studioId} />
                <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
                <label className="flex flex-col gap-1.5 md:col-span-2">
                  <span className={ui.label}>Title</span>
                  <input name="title" required className={ui.input} placeholder="Vinyasa Flow" />
                </label>
                <label className="flex flex-col gap-1.5 md:col-span-2">
                  <span className={ui.label}>Description</span>
                  <textarea name="description" rows={2} className={`${ui.input} min-h-16`} />
                </label>
                <label className="flex flex-col gap-1.5 md:col-span-2">
                  <span className={ui.label}>Tags</span>
                  <textarea
                    name="tags_input"
                    rows={3}
                    className={`${ui.input} min-h-20`}
                    placeholder={`Small group\nOpen level\nMat provided`}
                  />
                  <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Capacity</span>
                  <input name="capacity" type="number" min={1} defaultValue={10} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Duration (min)</span>
                  <input name="duration_min" type="number" min={15} step={5} defaultValue={60} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5 md:col-span-2">
                  <span className={ui.label}>Instructor</span>
                  <select name="instructor_id" className={ui.select}>
                    <option value="">—</option>
                    {(instructors ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <CoverVideoFields
                    studioId={studioId}
                    folder="classes"
                    entityId="new-class"
                    title="Class template media"
                    coverName="image_url"
                    videoName="video_url"
                    coverDefaultValue={null}
                    videoDefaultValue={null}
                    coverLabel="Cover image"
                    videoLabel="Promo video URL"
                  />
                </div>
                <SubmitButton className={`${ui.btnPrimarySm} md:col-span-2 w-fit`} pendingText="Saving...">
                  Save class template
                </SubmitButton>
              </ServerActionToastForm>
            </details>
          ) : null}
        </div>

        {!(classes ?? []).length ? (
          <div className={`mt-6 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No class templates yet.</p>
            {canEdit ? (
              <p className={`mt-1 text-xs ${ui.muted}`}>
                Expand &ldquo;+ New class template&rdquo; above to create your first one.
              </p>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-4 flex flex-col gap-2">
          {(classes ?? []).map((c) => {
            const tags = (c as { tags?: string[] | null }).tags ?? null;
            return (
              <li key={c.id} className={ui.card}>
                <ClassTemplateLifecycleRow
                  classId={c.id}
                  studioPublicSlug={studioMeta?.public_slug ?? null}
                  shareSlug={c.share_slug ?? null}
                  isActive={c.is_active !== false}
                  canEdit={canEdit}
                  canCopyLink={canCopyLink}
                  coverImageUrl={(c as { image_url?: string | null }).image_url ?? null}
                  tags={Array.isArray(tags) && tags.length > 0 ? tags : null}
                  initial={{
                    title: c.title,
                    description: (c as { description?: string | null }).description ?? null,
                    tags,
                    capacity: c.capacity,
                    duration_min: c.duration_min,
                    instructor_id: c.instructor_id,
                    location_id: c.location_id,
                    video_url: (c as { video_url?: string | null }).video_url ?? null,
                  }}
                  locations={locsForStudio}
                  instructors={insList}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
