import { createClassTemplate, createInstructor } from "@/app/dashboard/actions";
import { ClassTemplateLifecycleRow } from "@/components/dashboard/ClassTemplateLifecycleRow";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
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
        <h1 className={ui.h1}>Classes</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className={ui.muted}>Instructors and reusable class templates. Hidden templates cannot be used for new sessions.</p>
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to schedule
          </DashboardAppLink>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className={ui.h2}>Instructors</h2>
          {canEdit ? (
            <details className="chevron rounded-xl border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-800 dark:text-stone-200">
                <span>+ Add instructor</span>
              </summary>
              <form action={createInstructor} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="studio_id" value={studioId} />
                <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
                <label className="flex min-w-40 flex-col gap-1.5">
                  <span className={ui.label}>Name</span>
                  <input name="name" required className={ui.input} placeholder="Alex Kim" />
                </label>
                <SubmitButton className={ui.btnPrimarySm} pendingText="Adding...">
                  Add
                </SubmitButton>
              </form>
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
              <form action={createClassTemplate} className="mt-4 grid min-w-[min(42rem,calc(100vw-4rem))] gap-3 md:grid-cols-2">
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
                <SubmitButton className={`${ui.btnPrimarySm} md:col-span-2 w-fit`} pendingText="Saving...">
                  Save class template
                </SubmitButton>
              </form>
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

        <ul className="mt-4 flex flex-col gap-3">
          {(classes ?? []).map((c) => {
            const ins = c.instructors as { name?: string } | null;
            return (
              <li key={c.id} className={`${ui.card} p-4 sm:p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900 dark:text-stone-100">{c.title}</p>
                    <p className={`mt-1 text-sm ${ui.muted}`}>
                      cap {c.capacity} · {c.duration_min} min
                      {ins?.name ? ` · ${ins.name}` : ""}
                      {c.is_active === false ? " · Hidden" : ""}
                    </p>
                  </div>
                  {Array.isArray((c as { tags?: string[] | null }).tags) && (c as { tags: string[] }).tags.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {(c as { tags: string[] }).tags.slice(0, 3).map((tag) => (
                        <span key={`${c.id}-${tag}`} className={ui.badgeNeutral}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3">
                  <ClassTemplateLifecycleRow
                    classId={c.id}
                    studioPublicSlug={studioMeta?.public_slug ?? null}
                    shareSlug={c.share_slug ?? null}
                    isActive={c.is_active !== false}
                    canEdit={canEdit}
                    canCopyLink={canCopyLink}
                    coverImageUrl={(c as { image_url?: string | null }).image_url ?? null}
                    initial={{
                      title: c.title,
                      description: (c as { description?: string | null }).description ?? null,
                      tags: (c as { tags?: string[] | null }).tags ?? null,
                      capacity: c.capacity,
                      duration_min: c.duration_min,
                      instructor_id: c.instructor_id,
                      location_id: c.location_id,
                    }}
                    locations={locsForStudio}
                    instructors={insList}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
