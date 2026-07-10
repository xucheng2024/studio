import {
  createMemberZoneLesson,
  createMemberZoneSeries,
  deleteMemberZoneLesson,
  deleteMemberZoneSeries,
  updateMemberZoneLesson,
  updateMemberZoneSeries,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { LessonAccessPreview, SeriesAccessPreview } from "@/components/dashboard/MemberZoneAccessPreview";
import { CoverVideoFields } from "@/components/dashboard/PublicMediaFields";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type MemberZoneVisibilityFilter = "visible" | "all" | "hidden";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string; visibility?: MemberZoneVisibilityFilter }> };

function resolveVisibilityFilter(raw: string | undefined): MemberZoneVisibilityFilter {
  if (raw === "all" || raw === "hidden") return raw;
  return "visible";
}

export default async function DashboardMemberZonePage({ searchParams }: Props) {
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
  const visibilityFilter = resolveVisibilityFilter(sp.visibility);
  const [{ data: studio }, { data: rows }] = await Promise.all([
    supabase.from("studios").select("id, public_slug").eq("id", studioId).maybeSingle(),
    supabase
      .from("member_zone_series")
      .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, sort_order, is_active, share_slug, member_zone_lessons(id, title, summary, description, media_url, media_type, duration_min, access_override, override_price, sort_order, is_active)")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  const publicHref = studio.public_slug ? `/${studio.public_slug}#member-zone` : null;
  const scopedHref = (filter: MemberZoneVisibilityFilter) => {
    const params = new URLSearchParams();
    params.set("studio_id", studio.id);
    if (filter !== "visible") params.set("visibility", filter);
    return `/dashboard/member-zone?${params.toString()}`;
  };
  const allSeries = rows ?? [];
  const visibleSeriesCount = allSeries.filter((series) => series.is_active !== false).length;
  const hiddenSeriesCount = allSeries.filter((series) => series.is_active === false).length;
  const hiddenLessonCount = allSeries.reduce((sum, series) => {
    const lessonRows = Array.isArray(series.member_zone_lessons) ? series.member_zone_lessons : [];
    return sum + lessonRows.filter((lesson) => lesson.is_active === false).length;
  }, 0);
  const filteredRows = allSeries.filter((series) => {
    const lessonRows = Array.isArray(series.member_zone_lessons) ? series.member_zone_lessons : [];
    const hasHiddenLessons = lessonRows.some((lesson) => lesson.is_active === false);
    if (visibilityFilter === "all") return true;
    if (visibilityFilter === "hidden") return series.is_active === false || hasHiddenLessons;
    return series.is_active !== false;
  });

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Member zone setup</h1>
          <p className={ui.muted}>Create series and lessons for free, member-only, paid-only, or member-or-paid media learning.</p>
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
          Member zone content is managed at the studio level. It is intentionally not filtered by location.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <DashboardAppLink href={scopedHref("visible")} className={visibilityFilter === "visible" ? ui.btnPrimarySm : ui.btnSecondarySm}>
            Visible
          </DashboardAppLink>
          <DashboardAppLink href={scopedHref("all")} className={visibilityFilter === "all" ? ui.btnPrimarySm : ui.btnSecondarySm}>
            All
          </DashboardAppLink>
          <DashboardAppLink href={scopedHref("hidden")} className={visibilityFilter === "hidden" ? ui.btnPrimarySm : ui.btnSecondarySm}>
            Hidden
          </DashboardAppLink>
          <p className={`text-xs ${ui.muted}`}>
            {visibleSeriesCount} visible series, {hiddenSeriesCount} hidden series, {hiddenLessonCount} hidden lessons.
          </p>
        </div>
      </div>

      <details className={`chevron ${ui.card}`}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>+ Add series</span>
          <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
        </summary>
        <ServerActionToastForm action={createMemberZoneSeries} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={studio.id} />
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Series title</span>
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
            <span className={ui.label}>Access</span>
            <select name="access_type" defaultValue="member_only" className={ui.select}>
              <option value="member_only">Members only</option>
              <option value="paid_only">Paid only</option>
              <option value="member_or_paid">Member or paid</option>
              <option value="free">Free</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Price (SGD, if purchase is allowed)</span>
            <input name="price" type="number" min={0} step={0.01} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Sort order</span>
            <input name="sort_order" type="number" defaultValue={100} className={ui.input} />
          </label>
          <div className="sm:col-span-2">
            <SeriesAccessPreview initialAccessType="member_only" initialPrice={0} />
          </div>
          <div className="sm:col-span-2">
            <CoverVideoFields
              studioId={studio.id}
              folder="member-zone"
              entityId="new-series"
              title="Series media"
              coverName="cover_image_url"
              videoName="promo_video_url"
              coverDefaultValue={null}
              videoDefaultValue={null}
              coverLabel="Cover image"
              videoLabel="Promo video URL"
            />
          </div>
          <SubmitButton className={`${ui.btnPrimary} w-full sm:col-span-2 sm:w-fit`} pendingText="Creating...">
            Create series
          </SubmitButton>
        </ServerActionToastForm>
      </details>

      <div className="grid gap-4">
        {filteredRows.map((series) => {
          const lessonRows = Array.isArray(series.member_zone_lessons) ? series.member_zone_lessons : [];
          const visibleLessons = lessonRows.filter((lesson) => lesson.is_active !== false);
          const hiddenLessons = lessonRows.filter((lesson) => lesson.is_active === false);
          const lessons =
            visibilityFilter === "all"
              ? lessonRows
              : visibilityFilter === "hidden"
                ? (series.is_active === false ? lessonRows : hiddenLessons)
                : visibleLessons;
          const hiddenBySeries = series.is_active === false;
          return (
          <div key={series.id} className={ui.card}>
            <details className="chevron">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{series.title}</h3>
                    <span className={ui.badgeNeutral}>{series.access_type}</span>
                    {hiddenBySeries ? <span className={ui.badgeAmber}>Hidden</span> : null}
                  </div>
                  <p className={`mt-1 text-xs ${ui.muted}`}>
                    {series.price != null && Number(series.price) > 0 ? `SGD ${Number(series.price).toFixed(2)} · ` : ""}
                    {visibleLessons.length} visible · {hiddenLessons.length} hidden lessons
                  </p>
                </div>
                <ToastConfirmForm
                  action={deleteMemberZoneSeries}
                  confirmMessage="Hide this series from members?"
                  confirmLabel="Hide"
                  className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end"
                >
                  <input type="hidden" name="studio_id" value={studio.id} />
                  <input type="hidden" name="series_id" value={series.id} />
                  <button type="submit" className={ui.btnDangerSm}>
                    Hide series
                  </button>
                </ToastConfirmForm>
              </summary>
              <ServerActionToastForm action={updateMemberZoneSeries} className="mt-3">
              <input type="hidden" name="studio_id" value={studio.id} />
              <input type="hidden" name="series_id" value={series.id} />
              <div className="grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="is_active" defaultChecked={Boolean(series.is_active)} />
                  Visible to members
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Series title</span>
                  <input name="title" defaultValue={series.title} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Summary</span>
                  <input name="summary" defaultValue={series.summary ?? ""} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className={ui.label}>Description</span>
                  <textarea name="description" rows={3} defaultValue={series.description ?? ""} className={`${ui.input} min-h-24`} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Access</span>
                  <select name="access_type" defaultValue={series.access_type ?? "member_only"} className={ui.select}>
                    <option value="member_only">Members only</option>
                    <option value="paid_only">Paid only</option>
                    <option value="member_or_paid">Member or paid</option>
                    <option value="free">Free</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Price (SGD, if purchase is allowed)</span>
                  <input name="price" type="number" min={0} step={0.01} defaultValue={series.price != null && Number(series.price) > 0 ? Number(series.price) : ""} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Sort order</span>
                  <input name="sort_order" type="number" defaultValue={series.sort_order ?? 100} className={ui.input} />
                </label>
                <div className="sm:col-span-2">
                  <SeriesAccessPreview
                    initialAccessType={
                      (String(series.access_type ?? "member_only").toLowerCase() as "free" | "paid_only" | "member_only" | "member_or_paid")
                    }
                    initialPrice={Number(series.price ?? 0)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <CoverVideoFields
                    studioId={studio.id}
                    folder="member-zone"
                    entityId={series.id}
                    title={series.title}
                    coverName="cover_image_url"
                    videoName="promo_video_url"
                    coverDefaultValue={series.cover_image_url ?? null}
                    videoDefaultValue={series.promo_video_url ?? null}
                    coverLabel="Cover image"
                    videoLabel="Promo video URL"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">Save series</SubmitButton>
                </div>
              </div>
            </ServerActionToastForm>

            <div className="mt-4 border-t border-dashed border-stone-200 pt-3 dark:border-stone-800">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Lessons</h4>
                <span className={`text-xs ${ui.muted}`}>
                  {lessons.length} shown
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {[...lessons]
                  .sort((a, b) => Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100))
                  .map((lesson) => (
                  <div key={lesson.id}>
                  <ServerActionToastForm action={updateMemberZoneLesson} className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                    <input type="hidden" name="studio_id" value={studio.id} />
                    <input type="hidden" name="series_id" value={series.id} />
                    <input type="hidden" name="lesson_id" value={lesson.id} />
                    <details className="chevron">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold text-stone-900 dark:text-stone-100">{lesson.title}</p>
                            {!lesson.is_active ? <span className={ui.badgeNeutral}>Hidden</span> : null}
                          </div>
                          <p className={`mt-0.5 text-xs ${ui.muted}`}>
                            {lesson.media_type === "audio" ? "Audio" : "Video"} · {Number(lesson.duration_min ?? 0)} min · {lesson.access_override ?? "inherit"}
                          </p>
                        </div>
                        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                          <span className={`text-xs ${ui.muted}`}>Edit</span>
                        </div>
                      </summary>
                      <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Title</span><input name="title" defaultValue={lesson.title} className={ui.input} /></label>
                        <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Summary</span><input name="summary" defaultValue={lesson.summary ?? ""} className={ui.input} /></label>
                        <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Description</span><textarea name="description" rows={2} defaultValue={lesson.description ?? ""} className={`${ui.input} min-h-16`} /></label>
                        <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Media URL</span><input name="media_url" defaultValue={lesson.media_url} className={ui.input} /></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Media type</span><select name="media_type" defaultValue={lesson.media_type ?? "video"} className={ui.select}><option value="video">Video</option><option value="audio">Audio</option></select></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Duration (min)</span><input name="duration_min" type="number" min={0} defaultValue={lesson.duration_min ?? 0} className={ui.input} /></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Access override</span><select name="access_override" defaultValue={lesson.access_override ?? "inherit"} className={ui.select}><option value="inherit">Inherit series</option><option value="member_only">Members only</option><option value="paid_only">Paid only</option><option value="member_or_paid">Member or paid</option><option value="free">Free</option></select></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Override price (SGD)</span><input name="override_price" type="number" min={0} step={0.01} defaultValue={lesson.override_price != null && Number(lesson.override_price) > 0 ? Number(lesson.override_price) : ""} className={ui.input} /></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Sort order</span><input name="sort_order" type="number" defaultValue={lesson.sort_order ?? 100} className={ui.input} /></label>
                        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="is_active" defaultChecked={Boolean(lesson.is_active)} />Visible to members</label>
                        <div className="sm:col-span-2">
                          <LessonAccessPreview
                            initialSeriesAccessType={
                              (String(series.access_type ?? "member_only").toLowerCase() as "free" | "paid_only" | "member_only" | "member_or_paid")
                            }
                            initialSeriesPrice={Number(series.price ?? 0)}
                            initialOverride={
                              (String(lesson.access_override ?? "inherit").toLowerCase() as "inherit" | "free" | "paid_only" | "member_only" | "member_or_paid")
                            }
                            initialOverridePrice={Number(lesson.override_price ?? 0)}
                          />
                        </div>
                        <div className="mt-2 flex w-full shrink-0 flex-wrap gap-2 sm:col-span-2 sm:justify-end">
                          <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">Save lesson</SubmitButton>
                          <ToastConfirmForm
                            action={deleteMemberZoneLesson}
                            confirmMessage="Hide this lesson from members?"
                            confirmLabel="Hide"
                            className="inline-flex"
                          >
                            <input type="hidden" name="studio_id" value={studio.id} />
                            <input type="hidden" name="series_id" value={series.id} />
                            <input type="hidden" name="lesson_id" value={lesson.id} />
                            <button type="submit" className={ui.btnDangerSm}>
                              Hide lesson
                            </button>
                          </ToastConfirmForm>
                        </div>
                      </div>
                    </details>
                  </ServerActionToastForm>
                  </div>
                ))}
                {!lessons.length ? (
                  <div className="rounded-xl border border-dashed border-stone-200 px-3 py-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                    {visibilityFilter === "hidden"
                      ? "No hidden lessons in this series."
                      : "No lessons yet."}
                  </div>
                ) : null}
              </div>
              <details className="mt-3">
                <summary className={`cursor-pointer text-sm font-medium ${ui.muted}`}>+ Add lesson</summary>
                <ServerActionToastForm action={createMemberZoneLesson} className="mt-2 grid gap-2 rounded-xl border border-stone-200 p-3 dark:border-stone-700 sm:grid-cols-2">
                  <input type="hidden" name="studio_id" value={studio.id} />
                  <input type="hidden" name="series_id" value={series.id} />
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Title</span><input name="title" required className={ui.input} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Summary</span><input name="summary" className={ui.input} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Description</span><textarea name="description" rows={2} className={`${ui.input} min-h-16`} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Media URL</span><input name="media_url" required className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Media type</span><select name="media_type" defaultValue="video" className={ui.select}><option value="video">Video</option><option value="audio">Audio</option></select></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Duration (min)</span><input name="duration_min" type="number" min={0} defaultValue={0} className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Access override</span><select name="access_override" defaultValue="inherit" className={ui.select}><option value="inherit">Inherit series</option><option value="member_only">Members only</option><option value="paid_only">Paid only</option><option value="member_or_paid">Member or paid</option><option value="free">Free</option></select></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Override price (SGD)</span><input name="override_price" type="number" min={0} step={0.01} className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Sort order</span><input name="sort_order" type="number" defaultValue={100} className={ui.input} /></label>
                  <div className="sm:col-span-2">
                    <LessonAccessPreview
                      initialSeriesAccessType={
                        (String(series.access_type ?? "member_only").toLowerCase() as "free" | "paid_only" | "member_only" | "member_or_paid")
                      }
                      initialSeriesPrice={Number(series.price ?? 0)}
                      initialOverride="inherit"
                      initialOverridePrice={0}
                    />
                  </div>
                  <div className="sm:col-span-2"><SubmitButton className={ui.btnPrimarySm} pendingText="Creating...">Create lesson</SubmitButton></div>
                </ServerActionToastForm>
              </details>
            </div>
            </details>
          </div>
          );
        })}
        {!filteredRows.length ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>
              {visibilityFilter === "hidden"
                ? "No hidden member zone content."
                : visibilityFilter === "all"
                  ? "No member zone content yet."
                  : "No visible member zone content yet."}
            </p>
            <p className={`text-xs ${ui.muted}`}>
              {visibilityFilter === "hidden"
                ? "Switch to All or Visible to review published content."
                : "Create a series to start publishing lessons."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
