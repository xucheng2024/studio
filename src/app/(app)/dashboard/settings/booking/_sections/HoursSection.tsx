import { setLocationOperatingHoursWeekAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { listLocationOperatingHours, type LocationOperatingHours } from "@/lib/staff-availability";
import { ui } from "@/lib/ui";
import type { BookingSettingsContext } from "./context";
import { LocationBar } from "./LocationBar";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

function formatOperatingIntervals(hours: LocationOperatingHours[], weekday: number): string {
  return hours
    .filter((row) => row.weekday === weekday && !row.is_closed && row.opens_at && row.closes_at)
    .map((row) => `${String(row.opens_at).slice(0, 5)}-${String(row.closes_at).slice(0, 5)}`)
    .join(", ");
}

function isClosedWeekday(hours: LocationOperatingHours[], weekday: number): boolean {
  return hours.some((row) => row.weekday === weekday && row.is_closed);
}

export async function HoursSection({ ctx }: { ctx: BookingSettingsContext }) {
  const location = ctx.locations.find((row) => row.id === ctx.locationId) ?? null;
  if (!location) {
    return <p className={ui.muted}>Add a location first under Settings → Locations.</p>;
  }

  const hoursResult = await listLocationOperatingHours({
    userId: ctx.userId,
    email: ctx.email,
    studioId: ctx.studioId,
    locationId: location.id,
  });
  const operatingHours = hoursResult.ok ? hoursResult.hours : [];

  return (
    <div className="flex flex-col gap-4">
      <LocationBar ctx={ctx} />
      <div className={ui.card}>
        <h2 className={ui.h2}>Opening hours · {location.name}</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          Customers can only book inside these hours. Format each day as <code>09:00-13:00, 14:00-18:00</code>.
        </p>
        <ServerActionToastForm action={setLocationOperatingHoursWeekAction} className="mt-3 grid gap-3">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <input type="hidden" name="location_id" value={location.id} />
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
      </div>
    </div>
  );
}
