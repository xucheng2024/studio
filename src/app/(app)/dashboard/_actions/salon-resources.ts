"use server";

import { revalidateDashboardSettings } from "@/lib/revalidatePublic";
import {
  listSalonResources,
  setSalonResourceActive,
  upsertSalonResource,
  type ResourceType,
} from "@/lib/salon-resources";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

const RESOURCE_TYPES: ResourceType[] = ["room", "bed", "equipment", "other"];

export async function upsertSalonResourceAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const resourceType = String(formData.get("resource_type") ?? "").trim() as ResourceType;
  const resourceId = String(formData.get("resource_id") ?? "").trim() || null;
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const capacity = capacityRaw ? Number(capacityRaw) : 1;

  if (!studioId || !locationId || !name) return err("Please fill the required fields.");
  if (!RESOURCE_TYPES.includes(resourceType)) return err("Invalid resource type.");
  if (!Number.isFinite(capacity) || capacity <= 0) return err("Capacity must be a positive number.");

  const { user } = await requireUser();
  const result = await upsertSalonResource({
    userId: user.id,
    studioId,
    locationId,
    name,
    resourceType,
    capacity: Math.floor(capacity),
    resourceId,
  });
  if (!result.ok) return err(result.message ?? "Could not save resource.");

  revalidateDashboardSettings("resources");
  return ok(resourceId ? "Resource updated." : "Resource created.");
}

export async function setSalonResourceActiveAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const resourceId = String(formData.get("resource_id") ?? "").trim();
  const nextActive = formData.get("next_active") === "true";
  if (!studioId || !resourceId) return err("Please fill the required fields.");

  const { user } = await requireUser();
  const result = await setSalonResourceActive({ userId: user.id, studioId, resourceId, isActive: nextActive });
  if (!result.ok) return err(result.message ?? "Could not update resource status.");

  revalidateDashboardSettings("resources");
  return ok(nextActive ? "Resource enabled." : "Resource disabled.");
}

const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  room: "Room",
  bed: "Bed",
  equipment: "Equipment",
  other: "Other",
};

export async function bulkCreateSalonResourcesAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const { user } = await requireUser();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const resourceType = String(formData.get("resource_type") ?? "").trim() as ResourceType;
  const count = Number(formData.get("count") ?? "");
  if (!studioId || !locationId) return err("Please fill the required fields.");
  if (!RESOURCE_TYPES.includes(resourceType)) return err("Invalid resource type.");
  if (!Number.isInteger(count) || count < 1 || count > 20) return err("Count must be between 1 and 20.");

  const listed = await listSalonResources({
    userId: user.id,
    email: user.email,
    studioId,
    locationId,
  });
  if (!listed.ok) return err("Could not load existing resources.");
  const used = new Set(listed.resources.map((resource) => resource.name.toLowerCase()));
  const label = RESOURCE_TYPE_LABEL[resourceType];
  const created: string[] = [];
  let nextNumber = 1;
  while (created.length < count) {
    const name = `${label} ${nextNumber}`;
    nextNumber += 1;
    if (used.has(name.toLowerCase())) continue;
    const result = await upsertSalonResource({
      userId: user.id,
      studioId,
      locationId,
      name,
      resourceType,
      capacity: 1,
    });
    if (!result.ok) return err(result.message ?? "Could not add resources.");
    used.add(name.toLowerCase());
    created.push(name);
  }

  revalidateDashboardSettings("resources");
  return ok(`Added ${created.length} ${label.toLowerCase()}${created.length === 1 ? "" : "s"}.`);
}

export async function copySalonResourcesToLocationAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const { user } = await requireUser();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const targetLocationId = String(formData.get("target_location_id") ?? "").trim();
  if (!studioId || !locationId || !targetLocationId) return err("Please fill the required fields.");
  if (locationId === targetLocationId) return err("Choose a different location.");

  const [source, target] = await Promise.all([
    listSalonResources({ userId: user.id, email: user.email, studioId, locationId }),
    listSalonResources({ userId: user.id, email: user.email, studioId, locationId: targetLocationId }),
  ]);
  if (!source.ok) return err("Could not load resources for this location.");
  if (!target.ok) return err("Could not load resources for the target location.");

  const existingNames = new Set(target.resources.map((resource) => resource.name.toLowerCase()));
  let copied = 0;
  let skipped = 0;
  for (const resource of source.resources) {
    if (!resource.is_active) continue;
    if (existingNames.has(resource.name.toLowerCase())) {
      skipped += 1;
      continue;
    }
    const result = await upsertSalonResource({
      userId: user.id,
      studioId,
      locationId: targetLocationId,
      name: resource.name,
      resourceType: resource.resource_type,
      capacity: resource.capacity,
    });
    if (!result.ok) return err(result.message ?? "Could not copy resources.");
    existingNames.add(resource.name.toLowerCase());
    copied += 1;
  }

  if (copied === 0 && skipped === 0) return err("No active resources to copy.");
  revalidateDashboardSettings("resources");
  if (copied === 0) return ok("No new resources copied. Matching names were skipped.");
  return ok(skipped > 0 ? `Copied ${copied} resources, skipped ${skipped}.` : `Copied ${copied} resources.`);
}
