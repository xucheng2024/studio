import {
  createLocation,
  setLocationOperatingHoursWeekAction,
  toggleLocationActive,
  updateLocation,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { listLocationOperatingHours, type LocationOperatingHours } from "@/lib/staff-availability";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
  }>;
};

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

function scopedHref(path: string, selectedStudioId: string | null) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

function formatOperatingIntervals(hours: LocationOperatingHours[], weekday: number): string {
  return hours
    .filter((row) => row.weekday === weekday && !row.is_closed && row.opens_at && row.closes_at)
    .map((row) => `${String(row.opens_at).slice(0, 5)}-${String(row.closes_at).slice(0, 5)}`)
    .join(", ");
}

function isClosedWeekday(hours: LocationOperatingHours[], weekday: number): boolean {
  return hours.some((row) => row.weekday === weekday && row.is_closed);
}

export default async function SettingsLocationsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email,
      studioId: sp.studio_id ?? null,
      locationId: sp.location_id ?? null,
    },
    ["owner", "manager"],
  );
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name")
    .eq("id", activeStudioId)
    .maybeSingle();
  if (!studio) {
    return <p className={ui.muted}>Studio not found.</p>;
  }

  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, studio.id);
  const canManageLocationRecords = ctx.memberships.some(
    (membership) => membership.studio_id === studio.id && membership.location_id == null && membership.role === "owner",
  );

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, phone, is_active, created_at, studio_id")
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: true });

  const visibleLocations = (locations ?? []).filter(
    (location) => canViewAllLocations || accessibleLocationIds.includes(location.id),
  );
  const targetLocationId = selectedLocationId ?? visibleLocations[0]?.id ?? null;
  const targetLocation = visibleLocations.find((location) => location.id === targetLocationId) ?? null;

  const hoursResult = targetLocationId
    ? await listLocationOperatingHours({
        userId: user.id,
        email: user.email,
        studioId: studio.id,
        locationId: targetLocationId,
      })
    : null;
  const operatingHours = hoursResult?.ok ? hoursResult.hours : [];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Locations</h1>
          <p className={ui.muted}>Manage branches/venues for {studio.name} and configure operating hours.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId)} className={`${ui.btnSecondarySm} w-full sm:w-auto`}>
          Back to settings
        </DashboardAppLink>
      </div>

      {canManageLocationRecords ? (
        <ServerActionToastForm action={createLocation} className={`${ui.card} grid gap-3 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={studio.id} />
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className={ui.label}>Location name</span>
            <input name="name" required className={ui.input} placeholder="Downtown" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Address (optional)</span>
            <input name="address" className={ui.input} placeholder="123 Main St" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Phone (optional)</span>
            <FormPhoneField name="phone" />
          </label>
          <div className="md:col-span-2">
            <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Creating...">
              Add location
            </SubmitButton>
          </div>
        </ServerActionToastForm>
      ) : null}

      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locations ?? []}
          selectedStudioId={studio.id}
          selectedLocationId={selectedLocationId}
          allowAll={false}
          accessibleLocationIds={canViewAllLocations ? (locations ?? []).map((location) => location.id) : accessibleLocationIds}
        />
      </div>

      <div className={ui.card}>
        <p className={`mb-3 text-xs ${ui.muted}`}>Locations are used for schedule/frontdesk/operations filters and scoped staff access.</p>
        {visibleLocations.length === 0 ? (
          <p className={`text-sm ${ui.muted}`}>No locations added yet. Add one above to enable per-location filtering and scoped staff access.</p>
        ) : (
          <div className="space-y-3">
            {visibleLocations.map((loc) => (
              <div key={loc.id} className="rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-stone-900 dark:text-stone-100">{loc.name}</p>
                  <span
                    className={
                      loc.is_active
                        ? "rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                        : "rounded-md bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    }
                  >
                    {loc.is_active ? "Active" : "Disabled"}
                  </span>
                </div>
                {canManageLocationRecords ? (
                  <>
                    <ServerActionToastForm action={updateLocation} className="grid gap-2 md:grid-cols-3">
                      <input type="hidden" name="location_id" value={loc.id} />
                      <input name="name" required defaultValue={loc.name} className={ui.input} />
                      <input name="address" defaultValue={loc.address ?? ""} className={ui.input} placeholder="Address" />
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="min-w-0 flex-1">
                          <FormPhoneField name="phone" defaultValue={loc.phone ?? ""} />
                        </div>
                        <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-auto`} pendingText="Saving...">
                          Save
                        </SubmitButton>
                      </div>
                    </ServerActionToastForm>
                    <ServerActionToastForm action={toggleLocationActive} className="mt-2">
                      <input type="hidden" name="location_id" value={loc.id} />
                      <input type="hidden" name="next_active" value={loc.is_active ? "false" : "true"} />
                      <SubmitButton className={`${loc.is_active ? ui.btnGhost : ui.btnSecondarySm} w-full sm:w-auto`} pendingText="Updating...">
                        {loc.is_active ? "Disable" : "Enable"}
                      </SubmitButton>
                    </ServerActionToastForm>
                  </>
                ) : (
                  <p className={`text-xs ${ui.muted}`}>Only owners can edit location details.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={ui.card}>
        <h2 className={ui.h2}>Operating hours</h2>
        {!targetLocation ? (
          <p className={`mt-2 text-sm ${ui.muted}`}>Select a location above to manage operating hours.</p>
        ) : (
          <>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              Set weekly operating hours for {targetLocation.name}. Format each day as <code>09:00-13:00, 14:00-18:00</code>.
            </p>
            <ServerActionToastForm action={setLocationOperatingHoursWeekAction} className="mt-3 grid gap-3">
              <input type="hidden" name="studio_id" value={studio.id} />
              <input type="hidden" name="location_id" value={targetLocation.id} />
              {WEEKDAYS.map((weekday) => (
                <div key={weekday.value} className="grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-center">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{weekday.label}</span>
                  <input
                    name={`weekday_${weekday.value}`}
                    defaultValue={formatOperatingIntervals(operatingHours, weekday.value)}
                    className={ui.input}
                    placeholder="09:00-13:00, 14:00-18:00"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name={`closed_${weekday.value}`}
                      defaultChecked={isClosedWeekday(operatingHours, weekday.value)}
                    />
                    Closed
                  </label>
                </div>
              ))}
              <div>
                <SubmitButton className={`${ui.btnPrimarySm} w-full sm:w-fit`} pendingText="Saving...">
                  Save operating hours
                </SubmitButton>
              </div>
            </ServerActionToastForm>
          </>
        )}
      </div>
    </div>
  );
}
