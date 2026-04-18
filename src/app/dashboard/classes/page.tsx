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
  const { data: instructors } = await instructorsQuery;

  let classesQuery = supabase
    .from("classes")
    .select(
      `
      id,
      title,
      description,
      studio_id,
      capacity,
      duration_min,
      instructor_id,
      location_id,
      is_active,
      share_slug,
      instructors ( name )
    `,
    )
    .in("studio_id", studioIds)
    .order("title");
  if (selectedLocationId) classesQuery = classesQuery.eq("location_id", selectedLocationId);
  const { data: classes } = await classesQuery;

  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");

  const studioId = instructors?.[0]?.studio_id ?? classes?.[0]?.studio_id ?? studioIds[0];

  const { data: allInstructors } = await supabase
    .from("instructors")
    .select("id, name, studio_id")
    .eq("studio_id", studioId)
    .order("name");

  const { data: studioMeta } = await supabase
    .from("studios")
    .select("public_slug")
    .eq("id", studioId)
    .maybeSingle();

  const backParams = new URLSearchParams();
  if (selectedStudioId) backParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
  const backHref = `/dashboard/schedule${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  const locsForStudio = (locationRows ?? []).filter((l) => l.studio_id === studioId);
  const insList = (allInstructors ?? []).map((i) => ({ id: i.id, name: i.name }));

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className={ui.h1}>Classes</h1>
        <p className={`mt-1 ${ui.muted}`}>Instructors and reusable class templates. Hidden templates cannot be used for new sessions.</p>
        <div className="mt-3">
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to schedule
          </DashboardAppLink>
        </div>

        <h2 className={`${ui.h2} mt-8`}>Instructors</h2>
        {canEdit ? (
          <form
            action={createInstructor}
            className={`${ui.card} mt-4 flex flex-wrap items-end gap-3`}
          >
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
            <label className="flex min-w-[10rem] flex-col gap-1.5">
              <span className={ui.label}>Name</span>
              <input name="name" required className={ui.input} placeholder="Alex Kim" />
            </label>
            <SubmitButton className={ui.btnPrimary} pendingText="Adding...">
              Add
            </SubmitButton>
          </form>
        ) : null}
        <ul className={`mt-4 flex flex-wrap gap-2 text-sm ${ui.muted}`}>
          {(instructors ?? []).map((i) => (
            <li key={i.id} className="rounded-full bg-stone-100 px-3 py-1 dark:bg-stone-800">
              {i.name}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className={ui.h2}>Class templates</h2>
        {canEdit ? (
          <form action={createClassTemplate} className={`${ui.card} mt-4 grid gap-4 md:grid-cols-2`}>
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Title</span>
              <input name="title" required className={ui.input} placeholder="Vinyasa Flow" />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Description</span>
              <textarea
                name="description"
                rows={2}
                className={`${ui.input} min-h-[4rem]`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Capacity</span>
              <input
                name="capacity"
                type="number"
                min={1}
                defaultValue={10}
                className={ui.input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Duration (min)</span>
              <input
                name="duration_min"
                type="number"
                min={15}
                step={5}
                defaultValue={60}
                className={ui.input}
              />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Instructor</span>
              <select name="instructor_id" className={ui.select}>
                <option value="">—</option>
                {(instructors ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className={`${ui.btnPrimary} md:col-span-2`} pendingText="Saving...">
              Save class template
            </SubmitButton>
          </form>
        ) : null}

        <ul className="mt-6 flex flex-col gap-4">
          {(classes ?? []).map((c) => {
            const ins = c.instructors as { name?: string } | null;
            return (
              <li key={c.id} className={ui.card}>
                <p className="font-medium text-stone-900 dark:text-stone-100">{c.title}</p>
                <p className={`mt-1 text-sm ${ui.muted}`}>
                  cap {c.capacity} · {c.duration_min} min
                  {ins?.name ? ` · ${ins.name}` : ""}
                  {c.is_active === false ? " · Hidden" : ""}
                </p>
                <div className="mt-4">
                  <ClassTemplateLifecycleRow
                    classId={c.id}
                    studioPublicSlug={studioMeta?.public_slug ?? null}
                    shareSlug={c.share_slug ?? null}
                    isActive={c.is_active !== false}
                    canEdit={canEdit}
                    canCopyLink={canCopyLink}
                    initial={{
                      title: c.title,
                      description: (c as { description?: string | null }).description ?? null,
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
