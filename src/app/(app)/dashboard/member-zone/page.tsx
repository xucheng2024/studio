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
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

export default async function DashboardMemberZonePage({ searchParams }: Props) {
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
  if (studioIds.length === 0) return <p className={ui.muted}>Create your first studio in Overview.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role)) return <p className={ui.muted}>You do not have access to this page.</p>;

  const studioId = selectedStudioId ?? studioIds[0];
  const [{ data: studio }, { data: rows }] = await Promise.all([
    supabase.from("studios").select("id, public_slug").eq("id", studioId).maybeSingle(),
    supabase
      .from("member_zone_series")
      .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, currency, sort_order, is_active, share_slug, member_zone_lessons(id, title, summary, description, media_url, media_type, duration_min, access_override, override_price, currency, sort_order, is_active)")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  const overviewParams = new URLSearchParams();
  if (selectedStudioId) overviewParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) overviewParams.set("location_id", selectedLocationId);
  const publicHref = studio.public_slug ? `/${studio.public_slug}#member-zone` : null;

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

      <details className={`chevron ${ui.card}`}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>+ Add series</span>
          <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
        </summary>
        <form action={createMemberZoneSeries} className="mt-4 grid gap-4 sm:grid-cols-2">
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
            <span className={ui.label}>Price (if purchase is allowed)</span>
            <input name="price" type="number" min={0} step={0.01} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Currency</span>
            <input name="currency" defaultValue="SGD" className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Sort order</span>
            <input name="sort_order" type="number" defaultValue={100} className={ui.input} />
          </label>
          <div className="sm:col-span-2">
            <SeriesAccessPreview initialAccessType="member_only" initialCurrency="SGD" initialPrice={0} />
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
        </form>
      </details>

      <div className="grid gap-4">
        {(rows ?? []).map((series) => (
          <div key={series.id} className={ui.card}>
            <form action={updateMemberZoneSeries}>
              <input type="hidden" name="studio_id" value={studio.id} />
              <input type="hidden" name="series_id" value={series.id} />
            <details className="chevron">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{series.title}</h3>
                    {!series.is_active ? <span className={ui.badgeNeutral}>Inactive</span> : null}
                    <span className={ui.badgeNeutral}>{series.access_type}</span>
                  </div>
                  <p className={`mt-1 text-xs ${ui.muted}`}>
                    {series.price != null && Number(series.price) > 0 ? `${series.currency} ${Number(series.price).toFixed(2)} · ` : ""}
                    {Array.isArray(series.member_zone_lessons) ? series.member_zone_lessons.length : 0} lessons
                  </p>
                </div>
                <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                  <button type="submit" formAction={deleteMemberZoneSeries} className={ui.btnDangerSm}>
                    Remove
                  </button>
                </div>
              </summary>
              <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="is_active" defaultChecked={Boolean(series.is_active)} />
                  Active
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
                  <span className={ui.label}>Price (if purchase is allowed)</span>
                  <input name="price" type="number" min={0} step={0.01} defaultValue={series.price != null && Number(series.price) > 0 ? Number(series.price) : ""} className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Currency</span>
                  <input name="currency" defaultValue={series.currency ?? "SGD"} className={ui.input} />
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
                    initialCurrency={series.currency ?? "SGD"}
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
              </details>
            </form>

            <div className="mt-4 border-t border-dashed border-stone-200 pt-3 dark:border-stone-800">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Lessons</h4>
                <span className={`text-xs ${ui.muted}`}>
                  {Array.isArray(series.member_zone_lessons) ? series.member_zone_lessons.length : 0} total
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {(Array.isArray(series.member_zone_lessons) ? [...series.member_zone_lessons] : [])
                  .sort((a, b) => Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100))
                  .map((lesson) => (
                  <form key={lesson.id} action={updateMemberZoneLesson} className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                    <input type="hidden" name="studio_id" value={studio.id} />
                    <input type="hidden" name="series_id" value={series.id} />
                    <input type="hidden" name="lesson_id" value={lesson.id} />
                    <details className="chevron">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold text-stone-900 dark:text-stone-100">{lesson.title}</p>
                            {!lesson.is_active ? <span className={ui.badgeNeutral}>Inactive</span> : null}
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
                        <label className="flex flex-col gap-1"><span className={ui.label}>Override price</span><input name="override_price" type="number" min={0} step={0.01} defaultValue={lesson.override_price != null && Number(lesson.override_price) > 0 ? Number(lesson.override_price) : ""} className={ui.input} /></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Currency</span><input name="currency" defaultValue={lesson.currency ?? "SGD"} className={ui.input} /></label>
                        <label className="flex flex-col gap-1"><span className={ui.label}>Sort order</span><input name="sort_order" type="number" defaultValue={lesson.sort_order ?? 100} className={ui.input} /></label>
                        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="is_active" defaultChecked={Boolean(lesson.is_active)} />Active</label>
                        <div className="sm:col-span-2">
                          <LessonAccessPreview
                            initialSeriesAccessType={
                              (String(series.access_type ?? "member_only").toLowerCase() as "free" | "paid_only" | "member_only" | "member_or_paid")
                            }
                            initialSeriesCurrency={series.currency ?? "SGD"}
                            initialSeriesPrice={Number(series.price ?? 0)}
                            initialOverride={
                              (String(lesson.access_override ?? "inherit").toLowerCase() as "inherit" | "free" | "paid_only" | "member_only" | "member_or_paid")
                            }
                            initialOverrideCurrency={lesson.currency ?? "SGD"}
                            initialOverridePrice={Number(lesson.override_price ?? 0)}
                          />
                        </div>
                        <div className="mt-2 flex w-full shrink-0 flex-wrap gap-2 sm:col-span-2 sm:justify-end">
                          <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">Save lesson</SubmitButton>
                          <button type="submit" formAction={deleteMemberZoneLesson} className={ui.btnDangerSm}>Remove</button>
                        </div>
                      </div>
                    </details>
                  </form>
                ))}
              </div>
              <details className="mt-3">
                <summary className={`cursor-pointer text-sm font-medium ${ui.muted}`}>+ Add lesson</summary>
                <form action={createMemberZoneLesson} className="mt-2 grid gap-2 rounded-xl border border-stone-200 p-3 dark:border-stone-700 sm:grid-cols-2">
                  <input type="hidden" name="studio_id" value={studio.id} />
                  <input type="hidden" name="series_id" value={series.id} />
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Title</span><input name="title" required className={ui.input} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Summary</span><input name="summary" className={ui.input} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Description</span><textarea name="description" rows={2} className={`${ui.input} min-h-16`} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className={ui.label}>Media URL</span><input name="media_url" required className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Media type</span><select name="media_type" defaultValue="video" className={ui.select}><option value="video">Video</option><option value="audio">Audio</option></select></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Duration (min)</span><input name="duration_min" type="number" min={0} defaultValue={0} className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Access override</span><select name="access_override" defaultValue="inherit" className={ui.select}><option value="inherit">Inherit series</option><option value="member_only">Members only</option><option value="paid_only">Paid only</option><option value="member_or_paid">Member or paid</option><option value="free">Free</option></select></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Override price</span><input name="override_price" type="number" min={0} step={0.01} className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Currency</span><input name="currency" defaultValue="SGD" className={ui.input} /></label>
                  <label className="flex flex-col gap-1"><span className={ui.label}>Sort order</span><input name="sort_order" type="number" defaultValue={100} className={ui.input} /></label>
                  <div className="sm:col-span-2">
                    <LessonAccessPreview
                      initialSeriesAccessType={
                        (String(series.access_type ?? "member_only").toLowerCase() as "free" | "paid_only" | "member_only" | "member_or_paid")
                      }
                      initialSeriesCurrency={series.currency ?? "SGD"}
                      initialSeriesPrice={Number(series.price ?? 0)}
                      initialOverride="inherit"
                      initialOverrideCurrency="SGD"
                      initialOverridePrice={0}
                    />
                  </div>
                  <div className="sm:col-span-2"><SubmitButton className={ui.btnPrimarySm} pendingText="Creating...">Create lesson</SubmitButton></div>
                </form>
              </details>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
