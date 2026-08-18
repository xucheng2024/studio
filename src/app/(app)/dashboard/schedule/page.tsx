import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { CancelSessionButton } from "@/components/CancelSessionButton";
import { SessionEditPanel } from "@/components/SessionEditPanel";
import { SessionShareButton } from "@/components/SessionShareButton";
import { CreateSessionPanel } from "@/components/dashboard/CreateSessionPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { dayRangeEndInclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { generateShareSlugSegment, isValidShareSlug } from "@/lib/shareSlug";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CalendarCheck2 } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    session_status?: "all" | "scheduled" | "cancelled" | "completed";
    date_from?: string;
    date_to?: string;
  }>;
};

type SessionClassRef = {
  id?: string | null;
  title?: string | null;
  studio_id?: string | null;
  share_slug?: string | null;
};

function sessionClassRef(raw: unknown): SessionClassRef | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] as SessionClassRef | undefined) ?? null : (raw as SessionClassRef);
}

async function ensureClassShareSlug(
  admin: ReturnType<typeof createAdminClient>,
  classId: string,
  existing: string | null | undefined,
) {
  if (isValidShareSlug(existing)) return existing;
  for (let i = 0; i < 15; i++) {
    const candidate = generateShareSlugSegment(10);
    const { error } = await admin.from("classes").update({ share_slug: candidate }).eq("id", classId);
    if (!error) return candidate;
  }
  return null;
}

export default async function SchedulePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
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

  let classesQuery = supabase
    .from("classes")
    .select("id, title, studio_id, location_id, capacity, duration_min")
    .in("studio_id", studioIds)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("title");
  if (selectedLocationId) classesQuery = classesQuery.eq("location_id", selectedLocationId);

  const locationsQuery = supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");

  const [{ data: classes }, { data: locations }] = await Promise.all([
    classesQuery,
    locationsQuery,
  ]);
  const selectedLocation = selectedLocationId
    ? (locations ?? []).find((l) => l.id === selectedLocationId)
    : null;
  const activeStudioId = selectedLocation?.studio_id ?? (classes?.[0]?.studio_id ?? studioIds[0]);
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const scopeParams = new URLSearchParams();
  scopeParams.set("studio_id", activeStudioId);
  if (selectedLocationId) scopeParams.set("location_id", selectedLocationId);

  // Default window: today through the next 7 days.
  // Users can override via the date filter form.
  const now = new Date();
  const defaultDate = localISODate(now);
  const defaultEndDate = localISODate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const fallbackDateFrom = dayRangeStartIso(defaultDate)!;
  const fallbackDateTo = dayRangeEndInclusiveIso(defaultEndDate)!;

  const dateFrom = dayRangeStartIso(sp.date_from ?? defaultDate) ?? fallbackDateFrom;
  const dateTo = dayRangeEndInclusiveIso(sp.date_to ?? defaultEndDate) ?? fallbackDateTo;

  let sessionQuery = supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      end_time,
      class_title_snapshot,
      spots_left,
      status,
      capacity,
      guest_price,
      credits_required,
      location_id,
      address,
      address_details,
      classes!inner ( id, title, studio_id, share_slug ),
      locations ( id, name ),
      bookings (
        id,
        client_id,
        status,
        guest_name,
        guest_email,
        users ( email )
      )
    `,
    )
    .in("classes.studio_id", studioIds)
    .gte("start_time", dateFrom)
    .lte("start_time", dateTo)
    .order("start_time", { ascending: true })
    .limit(300);
  const sessionStatusFilter = sp.session_status ?? "scheduled";
  if (selectedLocationId) sessionQuery = sessionQuery.eq("location_id", selectedLocationId);
  if (sessionStatusFilter !== "all") sessionQuery = sessionQuery.eq("status", sessionStatusFilter);
  const { data: sessions } = await sessionQuery;
  const sessionRows = sessions ?? [];
  const { data: activeStudio } = await supabase
    .from("studios")
    .select("public_slug")
    .eq("id", activeStudioId)
    .maybeSingle();
  const classShareSlugs = new Map<string, string>();
  if (activeStudio?.public_slug && sessionRows.length > 0) {
    const classRefs = new Map<string, SessionClassRef>();
    for (const s of sessionRows) {
      const cls = sessionClassRef((s as { classes?: unknown }).classes);
      if (cls?.id && cls.studio_id === activeStudioId) classRefs.set(cls.id, cls);
    }
    const missingClassRefs: SessionClassRef[] = [];
    for (const cls of classRefs.values()) {
      if (!cls.id) continue;
      if (isValidShareSlug(cls.share_slug)) {
        classShareSlugs.set(cls.id, cls.share_slug!);
      } else {
        missingClassRefs.push(cls);
      }
    }
    if (missingClassRefs.length > 0) {
      const admin = createAdminClient();
      await Promise.all(missingClassRefs.map(async (cls) => {
        if (!cls.id) return;
        const slug = await ensureClassShareSlug(admin, cls.id, cls.share_slug);
        if (slug) classShareSlugs.set(cls.id, slug);
      }));
    }
  }
  const filteredSessions = sessionRows;

  const renderSessionCard = (s: (typeof filteredSessions)[number]) => {
    const cls = sessionClassRef((s as { classes?: unknown }).classes);
    const classTitle = (s as { class_title_snapshot?: string | null }).class_title_snapshot ?? cls?.title ?? "Class";
    const loc = s.locations as { name?: string | null } | { name?: string | null }[] | null;
    const locationName = Array.isArray(loc) ? loc[0]?.name ?? null : loc?.name ?? null;
    const sessionStatus = (s as { status?: string | null }).status ?? "scheduled";
    const isCancelled = sessionStatus === "cancelled";
    const isCompleted = sessionStatus === "completed";
    const isEditable = !isCancelled && !isCompleted;
    const bookings = (s.bookings ?? []) as {
      id: string;
      client_id: string | null;
      status: string;
      guest_name?: string | null;
      guest_email?: string | null;
      users?: { email?: string | null } | null;
    }[];
    const activeBookingCount = bookings.filter((b) => b.status === "booked" || b.status === "pending").length;
    const classSlug = cls?.id ? classShareSlugs.get(cls.id) : null;
    const sharePath =
      activeStudio?.public_slug && classSlug
        ? `/${activeStudio.public_slug}/classes/${classSlug}?session_id=${s.id}`
        : null;
    return (
      <li key={s.id} className={`${ui.card} ${isCancelled ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-stone-900 dark:text-stone-100">{classTitle}</p>
              {isCancelled ? (
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                  Cancelled
                </span>
              ) : null}
              {isCompleted ? (
                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
                  Completed
                </span>
              ) : null}
            </div>
            {locationName ? <p className={`mt-0.5 text-xs ${ui.muted}`}>{locationName}</p> : null}
            {(s as { address?: string | null }).address?.trim() ? (
              <p className={`mt-0.5 text-xs ${ui.muted}`}>{String((s as { address: string }).address)}</p>
            ) : null}
            <p className={`mt-1 text-sm ${ui.muted}`}>
              <LocalTime iso={String(s.start_time)} />
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
              <span>{s.spots_left} spots left</span>
              <span>{activeBookingCount} active bookings</span>
              {s.guest_price != null ? <span>{Number(s.guest_price) === 0 ? "Free guest" : `$${Number(s.guest_price).toFixed(2)} guest`}</span> : null}
              {s.credits_required != null ? (
                <span>
                  {Number(s.credits_required)} class pass{Number(s.credits_required) !== 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <SessionShareButton sharePath={sharePath} />
            <CancelSessionButton
              sessionId={s.id}
              classTitle={classTitle}
              startTimeIso={String(s.start_time)}
              locationName={locationName}
              sessionStatus={sessionStatus}
            />
          </div>
        </div>

        {isEditable ? (
          <div className="mt-3">
            <SessionEditPanel
              sessionId={s.id}
              initial={{
                start_time: String(s.start_time),
                duration_min: Math.max(
                  Math.round(
                    (new Date(String(s.end_time)).getTime() - new Date(String(s.start_time)).getTime()) / 60000,
                  ),
                  15,
                ),
                capacity: Number(s.capacity ?? 1),
                guest_price: s.guest_price != null ? Number(s.guest_price) : null,
                credits_required: s.credits_required != null ? Number(s.credits_required) : null,
                location_id: s.location_id ?? null,
                address: (s as { address?: string | null }).address ?? null,
                address_details: (s as { address_details?: string | null }).address_details ?? null,
              }}
              locations={(locations ?? [])
                .filter((l) => l.studio_id === activeStudioId)
                .map((l) => ({ id: l.id, name: l.name ?? "Unnamed location" }))}
            />
          </div>
        ) : null}

        <div className="mt-4 border-t border-dashed border-stone-200 pt-3 dark:border-stone-800">
          <p className={`text-xs ${ui.muted}`}>
            Attendee actions and payment/check-in operations are managed in Front desk.
          </p>
        </div>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-10">
      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locations ?? []}
          selectedStudioId={activeStudioId}
          selectedLocationId={selectedLocationId}
          allowAll={canViewAllLocations}
          accessibleLocationIds={accessibleLocationIds}
        />
      </div>
      <div>
        <h1 className={ui.h1}>Sessions</h1>
        <p className={`mt-1 ${ui.muted}`}>Schedule sessions and manage upcoming runs.</p>
        <div className="mt-6">
          <CreateSessionPanel
            classes={(classes ?? []).map((c) => ({
              id: c.id,
              title: c.title ?? "",
              capacity: c.capacity ?? 10,
              duration_min: c.duration_min ?? 60,
              location_id: c.location_id ?? null,
            }))}
            locations={(locations ?? [])
              .filter((l) => l.studio_id === activeStudioId)
              .map((l) => ({ id: l.id, name: l.name ?? "Unnamed location" }))}
            activeStudioId={activeStudioId}
            selectedLocationId={selectedLocationId ?? null}
            canManage={
              ctx.isSuperAdmin ||
              ctx.memberships.some(
                (m) => m.studio_id === activeStudioId && (m.role === "owner" || m.role === "manager"),
              )
            }
          />
        </div>
      </div>

      <div>
        <h2 className={ui.h2}>Sessions</h2>
        <form method="get" className={`${ui.card} mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Session status</span>
            <select name="session_status" className={ui.select} defaultValue={sessionStatusFilter}>
              <option value="all">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>From date</span>
            <input type="date" name="date_from" className={ui.input}
              defaultValue={sp.date_from ?? defaultDate} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>To date</span>
            <input type="date" name="date_to" className={ui.input}
              defaultValue={sp.date_to ?? defaultEndDate} />
          </label>
          <div className={`${ui.mobileActionBar} flex flex-col items-stretch gap-2 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-4`}>
            <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
              Apply
            </SubmitButton>
            <DashboardAppLink href={`/dashboard/schedule?${scopeParams.toString()}`} className={ui.btnGhost}>
              Reset
            </DashboardAppLink>
          </div>
        </form>
        {filteredSessions.length ? (
          <ul className="mt-4 flex flex-col gap-4">
            {filteredSessions.map((session) => renderSessionCard(session))}
          </ul>
        ) : null}

        {!filteredSessions.length ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <div className={ui.emptyStateIcon}><CalendarCheck2 size={18} /></div>
            <p className={`text-sm ${ui.muted}`}>No sessions match this filter.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
