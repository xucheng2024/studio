import {
  bulkCreateSalonResourcesAction,
  copySalonResourcesToLocationAction,
  setSalonResourceActiveAction,
  upsertSalonResourceAction,
} from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { listSalonResources, type ResourceType } from "@/lib/salon-resources";
import { ui } from "@/lib/ui";
import type { BookingSettingsContext } from "./context";
import { LocationBar } from "./LocationBar";

const RESOURCE_TYPES: Array<{ value: ResourceType; label: string }> = [
  { value: "room", label: "Room" },
  { value: "bed", label: "Bed" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

export async function ResourcesSection({ ctx }: { ctx: BookingSettingsContext }) {
  const locationId = ctx.locationId;
  if (!locationId) {
    return <p className={ui.muted}>Add a location first under Settings → Locations.</p>;
  }
  const otherLocations = ctx.locations.filter((location) => location.id !== locationId);

  const intro = (
    <p className={`text-sm ${ui.muted}`}>
      Only needed if a service requires a room, bed or equipment. Services without resource needs ignore this tab.
    </p>
  );
  const result = await listSalonResources({
    userId: ctx.userId,
    email: ctx.email,
    studioId: ctx.studioId,
    locationId: locationId,
  });
  const resources = result.ok ? result.resources : [];

  return (
    <div className="flex flex-col gap-4">
      <LocationBar ctx={ctx} />
      {intro}

      <details className={`chevron ${ui.card}`} open={resources.length === 0}>
        <summary className="cursor-pointer text-base font-semibold text-stone-900 dark:text-stone-100">
          + Add resource
        </summary>
        <ServerActionToastForm action={upsertSalonResourceAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <input type="hidden" name="location_id" value={locationId} />
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
        <ServerActionToastForm action={bulkCreateSalonResourcesAction} className="mt-4 grid gap-3 border-t border-stone-100 pt-3 dark:border-stone-800 sm:grid-cols-3">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <input type="hidden" name="location_id" value={locationId} />
          <p className="text-sm font-medium text-stone-900 dark:text-stone-100 sm:col-span-3">Quick add numbered resources</p>
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
            <span className={ui.label}>Count</span>
            <input name="count" type="number" min="1" max="20" defaultValue={3} className={ui.input} />
          </label>
          <div className="flex items-end">
            <SubmitButton className={`${ui.btnSecondarySm} w-full`} pendingText="Adding...">
              Add numbered
            </SubmitButton>
          </div>
        </ServerActionToastForm>
      </details>

      {otherLocations.length > 0 && resources.some((resource) => resource.is_active) ? (
        <div className={ui.card}>
          <h2 className={ui.h2}>Copy to another location</h2>
          <p className={`mt-1 text-xs ${ui.muted}`}>Copies active resources. Names that already exist at the target are skipped.</p>
          <ServerActionToastForm action={copySalonResourcesToLocationAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="studio_id" value={ctx.studioId} />
            <input type="hidden" name="location_id" value={locationId} />
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={ui.label}>Target location</span>
              <select name="target_location_id" required className={ui.select} defaultValue={otherLocations.length === 1 ? otherLocations[0].id : ""}>
                <option value="" disabled>
                  Choose a location
                </option>
                {otherLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Copying...">
              Copy resources
            </SubmitButton>
          </ServerActionToastForm>
        </div>
      ) : null}

      <div className={ui.card}>
        {resources.length === 0 ? (
          <p className={`text-sm ${ui.muted}`}>No resources added yet for this location.</p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {resources.map((resource) => (
              <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{resource.name}</p>
                    <span className={ui.badgeNeutral}>{resource.resource_type}</span>
                    {resource.capacity > 1 ? <span className={ui.badgeNeutral}>x{resource.capacity}</span> : null}
                    {!resource.is_active ? <span className={ui.badgeAmber}>Disabled</span> : null}
                  </div>
                  <details className="chevron mt-2">
                    <summary className={`cursor-pointer text-xs ${ui.muted}`}>Edit</summary>
                    <ServerActionToastForm action={upsertSalonResourceAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                      <input type="hidden" name="studio_id" value={ctx.studioId} />
                      <input type="hidden" name="location_id" value={locationId} />
                      <input type="hidden" name="resource_id" value={resource.id} />
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className={`${ui.label} text-xs`}>Resource name</span>
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
                  </details>
                </div>
                <ServerActionToastForm action={setSalonResourceActiveAction}>
                  <input type="hidden" name="studio_id" value={ctx.studioId} />
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
