import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import { BOOKING_TABS, bookingHref, parseBookingTab, type BookingSettingsContext } from "./_sections/context";
import { HoursSection } from "./_sections/HoursSection";
import { OverviewSection } from "./_sections/OverviewSection";
import { ResourcesSection } from "./_sections/ResourcesSection";
import { RulesSection } from "./_sections/RulesSection";
import { ServicesSection } from "./_sections/ServicesSection";
import { StaffSection } from "./_sections/StaffSection";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string; employee_id?: string; tab?: string }>;
};

export default async function DashboardBookingSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx: accessCtx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } =
    await getDashboardScopeForRoles(
      { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: sp.location_id ?? null },
      ["owner", "manager"],
    );
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(accessCtx, studioId);
  if (canViewAllLocations) {
    // Self-heal: anyone with studio access who is missing an employee record gets one.
    const { error: employeeSyncError } = await createAdminClient().rpc("sync_studio_employees", { p_studio_id: studioId });
    if (employeeSyncError) console.error(`booking settings employee sync: ${employeeSyncError.message}`);
  }
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("name");
  const locations = (locationRows ?? []).filter(
    (location) => canViewAllLocations || accessibleLocationIds.includes(location.id),
  );
  const locationId = locations.find((location) => location.id === selectedLocationId)?.id ?? locations[0]?.id ?? null;

  const ctx: BookingSettingsContext = {
    userId: user.id,
    email: user.email,
    studioId,
    selectedStudioId,
    locations,
    locationId,
    employeeId: sp.employee_id ?? null,
  };
  const tab = parseBookingTab(sp.tab);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <DashboardAppLink href={bookingHref(ctx, {}, "/dashboard/settings")} className={`${ui.btnSecondarySm} mb-3`}>
          Back to settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Online booking</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Everything that decides when customers can book: opening hours, staff schedules, which staff do which services, rooms, and booking rules.
        </p>
      </div>

      <nav aria-label="Booking settings" className="-mb-2 flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-stone-800">
        {BOOKING_TABS.map((item) => {
          const active = item.key === tab;
          return (
            <DashboardAppLink
              key={item.key}
              href={bookingHref(ctx, { tab: item.key === "overview" ? null : item.key, employee_id: null })}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? "border-teal-600 text-teal-700 dark:text-teal-300"
                  : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
            >
              {item.label}
            </DashboardAppLink>
          );
        })}
      </nav>

      {tab === "overview" ? <OverviewSection ctx={ctx} /> : null}
      {tab === "hours" ? <HoursSection ctx={ctx} /> : null}
      {tab === "staff" ? <StaffSection ctx={ctx} /> : null}
      {tab === "services" ? <ServicesSection ctx={ctx} /> : null}
      {tab === "resources" ? <ResourcesSection ctx={ctx} /> : null}
      {tab === "rules" ? <RulesSection ctx={ctx} /> : null}
    </div>
  );
}
