import { createEvent, deleteEvent, updateEvent } from "@/app/dashboard/actions";
import { CoverVideoFields } from "@/components/dashboard/PublicMediaFields";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { dayRangeEndInclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { CalendarRange, Clock3, Ticket } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    event_status?: "all" | "active" | "inactive";
    date_from?: string;
    date_to?: string;
  }>;
};

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

  const now = new Date();
  const defaultDate = localISODate(now);
  const defaultEndDate = localISODate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const fallbackDateFrom = dayRangeStartIso(defaultDate)!;
  const fallbackDateTo = dayRangeEndInclusiveIso(defaultEndDate)!;
  const dateFrom = dayRangeStartIso(sp.date_from ?? defaultDate) ?? fallbackDateFrom;
  const dateTo = dayRangeEndInclusiveIso(sp.date_to ?? defaultEndDate) ?? fallbackDateTo;
  const eventStatusFilter = sp.event_status ?? "all";

  let eventsQuery = supabase
    .from("events")
    .select("id, title, description, tags, studio_id, start_time, end_time, capacity, spots_left, price, currency, is_active, share_slug, image_url, video_url, address, address_details")
    .in("studio_id", studioIds)
    .gte("start_time", dateFrom)
    .lte("start_time", dateTo)
    .order("start_time", { ascending: false });
  const [{ data: events }, { data: studioMeta }] = await Promise.all([
    eventsQuery,
    supabase.from("studios").select("id, public_slug").in("id", studioIds).order("created_at", { ascending: true }),
  ]);

  const studioId = selectedStudioId ?? (events?.[0]?.studio_id as string | undefined) ?? studioIds[0];
  const studioPublicSlug =
    (studioMeta ?? []).find((s) => s.id === studioId)?.public_slug ?? null;
  const scopeParams = new URLSearchParams();
  scopeParams.set("studio_id", studioId);
  if (selectedLocationId) scopeParams.set("location_id", selectedLocationId);

  const studioEvents = (events ?? []).filter((e) => String(e.studio_id) === studioId);
  const filteredEvents = studioEvents.filter((event) => {
    if (eventStatusFilter === "active") return event.is_active !== false;
    if (eventStatusFilter === "inactive") return event.is_active === false;
    return true;
  });
  const activeCount = filteredEvents.filter((event) => event.is_active !== false).length;
  const inactiveCount = filteredEvents.filter((event) => event.is_active === false).length;
  const seatsRemaining = filteredEvents.reduce((sum, event) => sum + Number(event.spots_left ?? 0), 0);

  const renderEventCard = (e: any) => {
    const href = studioPublicSlug && e.share_slug ? `/event/${studioPublicSlug}/${e.share_slug}` : null;
    const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
    return (
      <form key={e.id} action={updateEvent} className={ui.card}>
        <input type="hidden" name="studio_id" value={studioId} />
        <input type="hidden" name="event_id" value={e.id} />

        {/* ── Card header (mirrors session row layout) ────────── */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {/* Thumbnail */}
            <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900 sm:size-[72px]">
              {(e as { image_url?: string | null }).image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={String((e as { image_url?: string | null }).image_url)} alt="" className="size-full object-cover" loading="lazy" />
              ) : null}
            </div>
            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-stone-900 dark:text-stone-100">{e.title}</p>
                {e.is_active === false ? (
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                    Inactive
                  </span>
                ) : null}
              </div>
              <p className={`mt-0.5 text-sm ${ui.muted}`}>
                {new Date(String(e.start_time)).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}
                {" – "}
                {new Date(String(e.end_time)).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                <span>SGD {Number(e.price ?? 0).toFixed(2)}</span>
                <span>{Number(e.spots_left ?? 0)} / {Number(e.capacity ?? 0)} spots left</span>
                {(e as { address?: string | null }).address ? (
                  <span>{String((e as { address?: string | null }).address)}</span>
                ) : null}
              </div>
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

          {/* Action buttons — right side, same layout as session row */}
          <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            {href ? <CopyUrlButton url={href} label="Copy event link" /> : null}
            {canEdit ? (
              <button type="submit" formAction={deleteEvent} className={ui.btnDangerSm}>
                Remove
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Edit panel (collapsible, mirrors SessionEditPanel style) ── */}
        {canEdit ? (
          <details className="chevron mt-3">
            <summary className={`cursor-pointer list-none text-sm font-medium ${ui.muted} hover:text-teal-700 dark:hover:text-teal-400`}>
              Edit event details
            </summary>
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
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Address</span>
                <input
                  name="address"
                  defaultValue={String((e as { address?: string | null }).address ?? "")}
                  className={ui.input}
                  placeholder="123 Orchard Rd, Singapore 238888"
                />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Address details</span>
                <textarea
                  name="address_details"
                  rows={2}
                  defaultValue={String((e as { address_details?: string | null }).address_details ?? "")}
                  className={`${ui.input} min-h-16`}
                  placeholder="Floor, room, check-in instructions (optional)"
                />
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
                <span className={ui.label}>Price (SGD)</span>
                <input name="price" type="number" min={0.01} step={0.01} defaultValue={Number(e.price ?? 1)} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Tags</span>
                <textarea name="tags_input" rows={3} defaultValue={(tags ?? []).join("\n")} className={`${ui.input} min-h-20`} />
                <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
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
          </details>
        ) : null}

        {/* ── Footer hint ──────────────────────────────────────── */}
        <div className="mt-4 border-t border-dashed border-stone-200 pt-3 dark:border-stone-800">
          <p className={`text-xs ${ui.muted}`}>
            Attendee actions and payment operations are managed in Bookings.
          </p>
        </div>
      </form>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Event setup</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className={ui.muted}>
            Create and maintain standalone paid events here. Booking handling stays in Booking management.
          </p>
          <DashboardAppLink href="/dashboard/schedule" className={ui.btnSecondarySm}>
            Back to sessions
          </DashboardAppLink>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <section className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
            <CalendarRange size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Events in range</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              {filteredEvents.length}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>{activeCount} active · {inactiveCount} inactive</p>
          </div>
        </section>
        <section className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <Ticket size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Open seats</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              {seatsRemaining}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>Across the current filtered list</p>
          </div>
        </section>
        <section className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <Clock3 size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Inactive events</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              {inactiveCount}
            </p>
            <p className={`mt-1 text-xs ${ui.muted}`}>Hidden from booking until reactivated</p>
          </div>
        </section>
      </div>

      {canEdit ? (
        <details className={`chevron ${ui.card} max-w-3xl`}>
          <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100">
            <span>+ New event</span>
            <span className={`text-xs font-normal ${ui.muted}`}>Paid standalone event</span>
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
              <span className={ui.label}>Address</span>
              <input name="address" required className={ui.input} placeholder="123 Orchard Rd, Singapore 238888" />
            </label>
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Address details</span>
              <textarea name="address_details" rows={2} className={`${ui.input} min-h-16`} placeholder="Floor, room, check-in instructions (optional)" />
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

      <section>
        <h2 className={ui.h2}>Events</h2>
        <form method="get" className={`${ui.card} mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Event status</span>
            <select name="event_status" className={ui.select} defaultValue={eventStatusFilter}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>From date</span>
            <input type="date" name="date_from" className={ui.input} defaultValue={sp.date_from ?? defaultDate} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>To date</span>
            <input type="date" name="date_to" className={ui.input} defaultValue={sp.date_to ?? defaultEndDate} />
          </label>
          <div className={`${ui.mobileActionBar} flex flex-col items-stretch gap-2 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-4`}>
            <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
              Apply
            </SubmitButton>
            <DashboardAppLink
              href={`/dashboard/events?${scopeParams.toString()}`}
              className={ui.btnGhost}
            >
              Reset
            </DashboardAppLink>
          </div>
        </form>

        {filteredEvents.length ? (
          <div className="mt-4 grid gap-4">
            {filteredEvents.map((e) => renderEventCard(e))}
          </div>
        ) : (
          <div className={`mt-4 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No events match this filter.</p>
          </div>
        )}
      </section>
    </div>
  );
}
