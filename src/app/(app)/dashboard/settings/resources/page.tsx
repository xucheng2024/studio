import { setSalonResourceActiveAction, upsertSalonResourceAction } from "@/app/(app)/dashboard/actions";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { listSalonResources, type ResourceType } from "@/lib/salon-resources";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

const RESOURCE_TYPES: Array<{ value: ResourceType; label: string }> = [
  { value: "room", label: "Room" },
  { value: "bed", label: "Bed" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

export default async function SalonResourcesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } =
    await getDashboardScopeForRoles(
      { userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: sp.location_id ?? null },
      ["owner", "manager"],
    );
  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, studioId);
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("name");

  const header = (
    <div>
      <h1 className={ui.h1}>Resources</h1>
      <p className={`mt-1 ${ui.muted}`}>Rooms, beds, and equipment available at each location.</p>
    </div>
  );
  const locationFilter = (
    <div className={`${ui.card} flex flex-wrap gap-3`}>
      <DashboardLocationFilter
        locations={locationRows ?? []}
        selectedStudioId={studioId}
        selectedLocationId={selectedLocationId}
        allowAll={false}
        accessibleLocationIds={canViewAllLocations ? (locationRows ?? []).map((l) => l.id) : accessibleLocationIds}
      />
    </div>
  );

  if (!selectedLocationId) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {locationFilter}
        <p className={ui.muted}>Select a location to manage its resources.</p>
      </div>
    );
  }

  const result = await listSalonResources({
    userId: user.id,
    email: user.email,
    studioId,
    locationId: selectedLocationId,
  });
  const resources = result.ok ? result.resources : [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {header}
      {locationFilter}

      <div className={ui.card}>
        <h2 className={ui.h2}>Add resource</h2>
        <ServerActionToastForm action={upsertSalonResourceAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="location_id" value={selectedLocationId} />
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Name</span>
            <input name="name" required className={ui.input} placeholder="Bed 1" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Type</span>
            <select name="resource_type" className={ui.select} defaultValue="bed">
              {RESOURCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Capacity</span>
            <input name="capacity" type="number" min="1" defaultValue={1} className={ui.input} />
          </label>
          <div className="sm:col-span-4">
            <SubmitButton className={`${ui.btnPrimary} w-full sm:w-fit`} pendingText="Adding...">
              Add resource
            </SubmitButton>
          </div>
        </ServerActionToastForm>
      </div>

      <div className={ui.card}>
        {resources.length === 0 ? (
          <p className={`text-sm ${ui.muted}`}>No resources added yet for this location.</p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <ServerActionToastForm action={upsertSalonResourceAction} className="grid gap-2 sm:grid-cols-4">
                    <input type="hidden" name="studio_id" value={studioId} />
                    <input type="hidden" name="location_id" value={selectedLocationId} />
                    <input type="hidden" name="resource_id" value={resource.id} />
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className={`${ui.label} text-xs`}>Name</span>
                      <input name="name" required defaultValue={resource.name} className={ui.input} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={`${ui.label} text-xs`}>Type</span>
                      <select name="resource_type" className={ui.select} defaultValue={resource.resource_type}>
                        {RESOURCE_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={`${ui.label} text-xs`}>Capacity</span>
                      <input name="capacity" type="number" min="1" defaultValue={resource.capacity} className={ui.input} />
                    </label>
                    <div className="sm:col-span-4">
                      <SubmitButton className={ui.btnSecondarySm} pendingText="Saving...">
                        Save resource
                      </SubmitButton>
                    </div>
                  </ServerActionToastForm>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={ui.badgeNeutral}>{resource.resource_type}</span>
                    {!resource.is_active ? <span className={ui.badgeAmber}>Disabled</span> : null}
                  </div>
                </div>
                <ServerActionToastForm action={setSalonResourceActiveAction}>
                  <input type="hidden" name="studio_id" value={studioId} />
                  <input type="hidden" name="resource_id" value={resource.id} />
                  <input type="hidden" name="next_active" value={String(!resource.is_active)} />
                  <SubmitButton className={resource.is_active ? ui.btnGhost : ui.btnSecondarySm} pendingText="Updating...">
                    {resource.is_active ? "Disable" : "Enable"}
                  </SubmitButton>
                </ServerActionToastForm>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
