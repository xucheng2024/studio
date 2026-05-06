import { createEvent, deleteEvent, updateEvent } from "@/app/dashboard/actions";
import { CoverVideoFields } from "@/components/dashboard/PublicMediaFields";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function DashboardEventsPage({ searchParams }: Props) {
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
  if (!selectedStudioId && studioIds.length > 1) return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;

  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) return <p className={ui.muted}>You do not have access to this page.</p>;
  const canEdit = ["owner", "manager"].includes(role);

  let eventsQuery = supabase
    .from("events")
    .select("id, title, description, tags, studio_id, location_id, start_time, end_time, capacity, spots_left, price, currency, is_active, share_slug, image_url, video_url")
    .in("studio_id", studioIds)
    .order("start_time", { ascending: false });
  if (selectedLocationId) eventsQuery = eventsQuery.eq("location_id", selectedLocationId);

  const locationsQuery = supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");

  const [{ data: events }, { data: locations }, { data: studioMeta }] = await Promise.all([
    eventsQuery,
    locationsQuery,
    supabase.from("studios").select("id, public_slug").in("id", studioIds).order("created_at", { ascending: true }),
  ]);

  const studioId = selectedStudioId ?? (events?.[0]?.studio_id as string | undefined) ?? studioIds[0];
  const studioPublicSlug =
    (studioMeta ?? []).find((s) => s.id === studioId)?.public_slug ?? null;

  const locsForStudio = (locations ?? []).filter((l) => l.studio_id === studioId).map((l) => ({ id: l.id, name: l.name ?? "Unnamed location" }));

  const now = Date.now();
  const studioEvents = (events ?? []).filter((e) => String(e.studio_id) === studioId);
  const upcomingEvents = studioEvents
    .filter((e) => new Date(String(e.end_time)).getTime() >= now)
    .sort((a, b) => new Date(String(a.start_time)).getTime() - new Date(String(b.start_time)).getTime());
  const pastEvents = studioEvents
    .filter((e) => new Date(String(e.end_time)).getTime() < now)
    .sort((a, b) => new Date(String(b.start_time)).getTime() - new Date(String(a.start_time)).getTime());
  const UPCOMING_PREVIEW_COUNT = 6;
  const PAST_PREVIEW_COUNT = 4;

  const renderEventCard = (e: any, opts?: { muted?: boolean }) => {
    const href = studioPublicSlug && e.share_slug ? `/event/${studioPublicSlug}/${e.share_slug}` : null;
    const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
    const muted = opts?.muted === true;
    return (
      <form key={e.id} action={updateEvent} className={`${ui.card} ${muted ? "opacity-70" : ""}`}>
        <input type="hidden" name="studio_id" value={studioId} />
        <input type="hidden" name="event_id" value={e.id} />
        <details className="chevron">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900 sm:size-[72px]">
                {(e as { image_url?: string | null }).image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={String((e as { image_url?: string | null }).image_url)} alt="" className="size-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{e.title}</h3>
                  {e.is_active === false ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      Inactive
                    </span>
                  ) : null}
                </div>
                <p className={`mt-0.5 text-xs ${ui.muted}`}>
                  {new Date(String(e.start_time)).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}
                  {" · "}
                  {new Date(String(e.end_time)).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}
                </p>
                <p className={`mt-0.5 text-xs ${ui.muted}`}>
                  SGD {Number(e.price ?? 0).toFixed(2)} · cap {Number(e.capacity ?? 0)} · {Number(e.spots_left ?? 0)} left
                </p>
                {href ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`font-mono text-[11px] ${ui.muted}`}>{href}</span>
                    <CopyUrlButton url={href} className="h-8 px-2 text-xs" />
                  </div>
                ) : null}
                {tags.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Array.from(new Map(tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
                      .filter(Boolean)
                      .slice(0, 4)
                      .map((tag) => (
                        <span key={`${e.id}-${tag.toLowerCase()}`} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                          {tag}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>

            {canEdit ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button type="submit" formAction={deleteEvent} className={`${ui.btnDangerSm} px-2`}>
                  Delete
                </button>
              </div>
            ) : null}
          </summary>

          {canEdit ? (
            <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="is_active" defaultChecked={Boolean(e.is_active)} />
                Active
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Title</span>
                <input name="title" defaultValue={String(e.title ?? "")} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Description</span>
                <textarea name="description" rows={3} defaultValue={String(e.description ?? "")} className={`${ui.input} min-h-24`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Start</span>
                <input name="start_time" type="datetime-local" defaultValue={new Date(String(e.start_time)).toISOString().slice(0, 16)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>End</span>
                <input name="end_time" type="datetime-local" defaultValue={new Date(String(e.end_time)).toISOString().slice(0, 16)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Capacity</span>
                <input name="capacity" type="number" min={1} step={1} defaultValue={Number(e.capacity ?? 1)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Price</span>
                <input name="price" type="number" min={0.01} step={0.01} defaultValue={Number(e.price ?? 1)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Tags</span>
                <textarea name="tags_input" rows={3} defaultValue={(tags ?? []).join("\n")} className={`${ui.input} min-h-20`} />
                <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Location</span>
                <select name="location_id" defaultValue={String(e.location_id ?? "")} className={ui.select}>
                  <option value="">—</option>
                  {locsForStudio.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2">
                <CoverVideoFields
                  studioId={studioId}
                  folder="events"
                  entityId={String(e.id)}
                  title="Event media"
                  coverName="image_url"
                  videoName="video_url"
                  coverDefaultValue={(e as { image_url?: string | null }).image_url ?? null}
                  videoDefaultValue={(e as { video_url?: string | null }).video_url ?? null}
                  coverLabel="Cover image"
                  videoLabel="Promo video URL"
                />
              </div>
              <SubmitButton className={`${ui.btnPrimarySm} w-fit sm:col-span-2`} pendingText="Saving...">
                Save changes
              </SubmitButton>
            </div>
          ) : null}
        </details>
      </form>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Events</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className={ui.muted}>Standalone paid events (no class template).</p>
          <DashboardAppLink href="/dashboard/schedule" className={ui.btnSecondarySm}>
            Back to schedule
          </DashboardAppLink>
        </div>
      </div>

      {canEdit ? (
        <details className={`chevron ${ui.card} max-w-3xl`}>
          <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100">
            <span>+ Create event</span>
            <span className={`text-xs font-normal ${ui.muted}`}>Paid only</span>
          </summary>
          <form action={createEvent} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="studio_id" value={studioId} />
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Title</span>
              <input name="title" required className={ui.input} placeholder="Hotel partner workshop" />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Description</span>
              <textarea name="description" rows={2} className={`${ui.input} min-h-16`} />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Tags</span>
              <textarea name="tags_input" rows={3} className={`${ui.input} min-h-20`} placeholder={`Hotel\nPartner\nWellness`} />
              <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Start</span>
              <input name="start_time" type="datetime-local" required className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>End</span>
              <input name="end_time" type="datetime-local" required className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Capacity</span>
              <input name="capacity" type="number" min={1} step={1} required defaultValue={20} className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Price (SGD)</span>
              <input name="price" type="number" min={0.01} step={0.01} required defaultValue={120} className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Location</span>
              <select name="location_id" className={ui.select} defaultValue={selectedLocationId ?? ""}>
                <option value="">—</option>
                {locsForStudio.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2">
              <CoverVideoFields
                studioId={studioId}
                folder="events"
                entityId="new-event"
                title="Event media"
                coverName="image_url"
                videoName="video_url"
                coverDefaultValue={null}
                videoDefaultValue={null}
                coverLabel="Cover image"
                videoLabel="Promo video URL"
              />
            </div>
            <SubmitButton className={`${ui.btnPrimarySm} md:col-span-2 w-fit`} pendingText="Saving...">
              Save event
            </SubmitButton>
          </form>
        </details>
      ) : null}

      {/* ── Upcoming ───────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className={ui.h2}>Upcoming events</h2>
            <span className={ui.badgeNeutral}>{upcomingEvents.length}</span>
          </div>
        </div>

        {upcomingEvents.length ? (
          <div className="mt-4 grid gap-4">
            {upcomingEvents.slice(0, UPCOMING_PREVIEW_COUNT).map((e) => renderEventCard(e))}
            {upcomingEvents.length > UPCOMING_PREVIEW_COUNT ? (
              <details className="chevron">
                <summary className={`cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400`}>
                  <span className="group-open:hidden">Show {upcomingEvents.length - UPCOMING_PREVIEW_COUNT} more</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <div className="mt-4 grid gap-4">
                  {upcomingEvents.slice(UPCOMING_PREVIEW_COUNT).map((e) => renderEventCard(e))}
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <div className={`mt-4 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No upcoming events.</p>
          </div>
        )}
      </section>

      {/* ── Past ───────────────────────────────────────────────── */}
      <section>
        <details className="chevron group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className={ui.h2}>Past events</h2>
              <span className={ui.badgeNeutral}>{pastEvents.length}</span>
            </div>
            <span className={`text-xs font-normal ${ui.muted}`}>Collapsed by default</span>
          </summary>

          {pastEvents.length ? (
            <div className="mt-4 grid gap-4">
              {pastEvents.slice(0, PAST_PREVIEW_COUNT).map((e) => renderEventCard(e, { muted: true }))}
              {pastEvents.length > PAST_PREVIEW_COUNT ? (
                <details className="chevron">
                  <summary className={`cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400`}>
                    <span className="group-open:hidden">Show {pastEvents.length - PAST_PREVIEW_COUNT} more</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <div className="mt-4 grid gap-4">
                    {pastEvents.slice(PAST_PREVIEW_COUNT).map((e) => renderEventCard(e, { muted: true }))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <div className={`mt-4 ${ui.emptyState}`}>
              <p className={`text-sm ${ui.muted}`}>No past events.</p>
            </div>
          )}
        </details>
      </section>
    </div>
  );
}

