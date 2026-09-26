export const BOOKING_TABS = [
  { key: "overview", label: "Overview" },
  { key: "hours", label: "Opening hours" },
  { key: "staff", label: "Staff schedules" },
  { key: "services", label: "Services" },
  { key: "resources", label: "Resources" },
  { key: "rules", label: "Rules & terms" },
] as const;

export type BookingTab = (typeof BOOKING_TABS)[number]["key"];

export function parseBookingTab(raw: string | undefined): BookingTab {
  return BOOKING_TABS.some((tab) => tab.key === raw) ? (raw as BookingTab) : "overview";
}

export type BookingLocation = { id: string; name: string; studio_id: string };

export type BookingSettingsContext = {
  userId: string;
  email: string | null | undefined;
  studioId: string;
  selectedStudioId: string | null;
  /** Active locations the caller may manage. */
  locations: BookingLocation[];
  /** Effective location for location-scoped tabs (selected, else the first accessible one). */
  locationId: string | null;
  employeeId: string | null;
};

/** Build a booking-settings URL; `href` may already carry a query (e.g. `?tab=hours`). */
export function bookingHref(
  ctx: Pick<BookingSettingsContext, "selectedStudioId" | "locationId">,
  params: Record<string, string | null | undefined> = {},
  base = "/dashboard/settings/booking",
) {
  const [path, rawQuery = ""] = base.split("?");
  const query = new URLSearchParams(rawQuery);
  if (ctx.selectedStudioId) query.set("studio_id", ctx.selectedStudioId);
  if (ctx.locationId && path === "/dashboard/settings/booking") query.set("location_id", ctx.locationId);
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
